import type { Request, Response } from "express";
import { getDb } from "../db/client.js";
import { appSessionRepo, resolveSessionConfig, hashUa, deviceLabelFromUa, type SessionPrincipal } from "../db/repos/appSessionRepo.js";
import { appUserRepo } from "../db/repos/appUserRepo.js";
import { aiBotRepo } from "../db/repos/aiBotRepo.js";
import { validateToken, readIssuerFromToken, readAudienceFromToken } from "./oidcValidate.js";
import { getProviderByIssuer } from "../cache/providerCache.js";
import { config } from "../config/appConfig.js";
import type { CachedApp } from "../cache/appCache.js";
import { appRepo } from "../db/repos/appRepo.js";
import { maybeStartTwoFactor } from "./appTwoFactor.js";

/**
 * App-scoped session authentication (orc_sid cookies).
 * See Execution Plan/Orchestrator/Features/AppScopedSessions-9.md
 *
 * Isolation rules enforced here:
 *   - App users live in `app_users` (per app) — dashboard admins (`users`) can never
 *     authenticate here, and app users can never authenticate to the dashboard.
 *   - Every session row is bound to one app_id; cross-app cookie reuse is rejected.
 *   - This module never reads the dashboard cookie; dashboardAuth never reads orc_sid.
 */

// Reserved paths under each app's base_path — provisioned up front, live per method.
export const RESERVED_APP_AUTH_PATHS = new Set([
  "/login", "/session/verify",
  "/__logout", "/__logout-others",
  "/__me", "/__devices",
]);

export function sessionCookieName(app: Pick<CachedApp, "base_path" | "session_config">): string {
  const cfg = resolveSessionConfig(app as any);
  if (cfg.cookie_name) return cfg.cookie_name;
  const slug = app.base_path.split("/").filter(Boolean).join("_") || "app";
  return `orc_sid_${slug}`;
}

// RFC 6265 token — no separators, no whitespace, no control chars
const COOKIE_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/**
 * Admin-defined cookie name validation (server-side, on save):
 *   1. format: RFC 6265 token, max 64 chars
 *   2. unique across all apps — a name is claimed permanently once set
 *   3. must never equal the dashboard admin cookie name (same origin in
 *      unified mode — a collision would overwrite one session with the other)
 */
export function validateCookieName(db: ReturnType<typeof getDb>, appId: string, name: string): string | null {
  const trimmed = name.trim();
  if (trimmed !== name) return "Cookie name must not have leading or trailing whitespace";
  if (trimmed.length > 64) return "Cookie name must be at most 64 characters";
  if (!COOKIE_NAME_RE.test(trimmed)) {
    return "Cookie name may only contain letters, digits and !#$%&'*+-.^_`|~ (RFC 6265 token)";
  }
  if (trimmed === config.cookies.name) {
    return `"${trimmed}" is reserved for the gateway admin login and cannot be used by an app`;
  }
  for (const other of appRepo.list(db)) {
    if (other.id === appId) continue;
    const otherName = sessionCookieName(other as any);
    if (otherName === trimmed) {
      return `Cookie name "${trimmed}" is already used by app "${other.name}" (${other.base_path})`;
    }
  }
  return null;
}

function cookieOptions(maxAgeMin: number) {
  return {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: "lax" as const,     // dashboard uses strict; app sessions must survive top-level navigation from the frontend origin
    path: "/",
    maxAge: maxAgeMin * 60_000,
  };
}

// ── Per-IP login failure limiter (in-memory fixed window) ─────────────────────
// Limits are per-app, configured in App → Settings → Runtime Authentication.
// Defaults: 10 failures / 15-min window. Cleared on container restart.

const failures = new Map<string, { count: number; resetAt: number }>();

function limiterKey(appId: string, ip: string) { return `${appId}:${ip}`; }

function checkLimiter(appId: string, ip: string, max: number, windowMs: number): boolean {
  const key = limiterKey(appId, ip);
  const entry = failures.get(key);
  if (!entry) return true;
  if (Date.now() > entry.resetAt) { failures.delete(key); return true; }
  return entry.count < max;
}

function recordFailure(appId: string, ip: string, windowMs: number): void {
  const key = limiterKey(appId, ip);
  const entry = failures.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    failures.set(key, { count: 1, resetAt: Date.now() + windowMs });
  } else {
    entry.count++;
  }
}

export function stopLoginLimiterSweep(): void { failures.clear(); }

export function clientIp(req: Request): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
}

// ── Session validation for runtime requests ───────────────────────────────────

export type SessionAuthResult =
  | { ok: true; principal: SessionPrincipal; normalised: { sub: string; email: string | null; roles: string[]; issuer: string } }
  | { ok: false; status: number; error: string; code: string };

/**
 * Validate the app's orc_sid cookie for a runtime request.
 * Enforces: app binding (findValid), UA fingerprint per strictness, both clocks,
 * then slides the idle window and updates last_seen_ip (IP is never a gate).
 */
export function resolveSessionForRequest(req: Request, app: CachedApp): SessionAuthResult {
  const db = getDb();
  const cfg = resolveSessionConfig(app as any);
  const cookieName = sessionCookieName(app);
  const cookieValue = req.cookies?.[cookieName] as string | undefined;
  if (!cookieValue) {
    return { ok: false, status: 401, error: "Login required — no session cookie", code: "MISSING_SESSION" };
  }

  const principal = appSessionRepo.findValid(db, cookieValue, app.id);
  if (!principal) {
    return { ok: false, status: 401, error: "Session invalid, expired, or not valid for this app", code: "INVALID_SESSION" };
  }

  // Fingerprint — UA hash is the only enforceable component; IP is metadata.
  const uaHash = hashUa(req.headers["user-agent"] ?? "");
  if (uaHash !== principal.uaHash) {
    if (cfg.ua_enforce === "enforce") {
      return { ok: false, status: 401, error: "Session device fingerprint mismatch", code: "FINGERPRINT_MISMATCH" };
    }
    if (cfg.ua_enforce === "flag") {
      console.warn(`[app-session] UA mismatch (flagged, allowed): app=${app.base_path} sub=${principal.sub} session=${principal.sessionId}`);
    }
  }

  appSessionRepo.touch(db, principal.sessionId, cfg, clientIp(req));

  return {
    ok: true,
    principal,
    normalised: { sub: principal.sub, email: principal.email, roles: [], issuer: principal.issuer },
  };
}

// ── Reserved auth routes (relative to base_path) ──────────────────────────────

function botSnapshotForApp(appId: string): string[] {
  return aiBotRepo.listBotsForApp(getDb(), appId).map(b => b.id);
}

/** Mint an orc_sid session and set the cookie — no response body. */
export function mintSessionCookie(req: Request, res: Response, app: CachedApp, params: {
  sub: string; email: string | null; issuer: string; idpToken?: string | null;
}): void {
  const db = getDb();
  const cfg = resolveSessionConfig(app as any);
  const principal = appSessionRepo.mint(db, {
    app_id: app.id,
    sub: params.sub,
    email: params.email,
    issuer: params.issuer,
    user_agent: req.headers["user-agent"] ?? "",
    ip: clientIp(req),
    idp_token: params.idpToken ?? null,
    bot_snapshot: botSnapshotForApp(app.id),
  }, cfg);
  res.cookie(sessionCookieName(app), principal.sessionId, cookieOptions(cfg.max_age_min));
}

function mintAndSetCookie(req: Request, res: Response, app: CachedApp, params: {
  sub: string; email: string | null; issuer: string; idpToken?: string | null;
}): void {
  mintSessionCookie(req, res, app, params);
  const cfg = resolveSessionConfig(app as any);
  res.status(200).json({
    sub: params.sub,
    email: params.email,
    device_label: deviceLabelFromUa(req.headers["user-agent"] ?? ""),
    expires_in_min: cfg.max_age_min,
  });
}

function appNotFound(res: Response) {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
}

/**
 * Dispatch a reserved app-auth route. Returns true when the request was handled.
 * Caller must invoke BEFORE endpoint auth — /login and /session/verify are
 * intentionally unauthenticated.
 */
export async function handleAppAuthRoute(req: Request, res: Response, app: CachedApp, relativePath: string): Promise<boolean> {
  const db = getDb();
  const cfg = resolveSessionConfig(app as any);
  const method = req.method.toUpperCase();
  const authMode = (app as any).auth_mode ?? "bearer";
  const sessionAuthOn = authMode === "session" || authMode === "both";

  // ── POST /login — gateway credentials ───────────────────────────────────────
  if (relativePath === "/login") {
    if (method !== "POST") return appNotFound(res), true;
    if (!sessionAuthOn || !["gateway", "both"].includes((app as any).session_method ?? "both")) {
      return appNotFound(res), true;
    }
    const ip = clientIp(req);
    if (!checkLimiter(app.id, ip, cfg.login_rate_limit_max, cfg.login_rate_limit_window_min * 60_000)) {
      res.status(429).json({ error: `Too many failed login attempts — try again in ${cfg.login_rate_limit_window_min} minutes`, code: "RATE_LIMITED" });
      return true;
    }
    const { username, email, identifier, password } = (req.body ?? {}) as Record<string, string>;
    const ident = identifier ?? username ?? email;
    if (!ident || !password) {
      res.status(400).json({ error: "username (or email) and password are required", code: "VALIDATION_ERROR" });
      return true;
    }
    const user = await appUserRepo.verifyCredentials(db, app.id, ident, password);
    if (!user) {
      recordFailure(app.id, ip, cfg.login_rate_limit_window_min * 60_000);
      res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
      return true;
    }
    // Self-signup users stay locked out until their email is verified.
    if (!user.email_verified && cfg.require_email_verification !== false) {
      res.status(403).json({
        error: "Email not verified — check your inbox for the verification link",
        code: "EMAIL_NOT_VERIFIED",
      });
      return true;
    }
    // Two-factor: when this user needs factor 2, maybeStartTwoFactor responds
    // (challenge created, pending_token issued) and no session is minted yet.
    const twofaStarted = await maybeStartTwoFactor(req, res, app, user);
    if (twofaStarted) return true;
    appUserRepo.touchLogin(db, user.id);
    mintAndSetCookie(req, res, app, { sub: user.sub, email: user.email, issuer: `gateway:${app.id}` });
    return true;
  }

  // ── POST /session/verify — identity provider token ──────────────────────────
  if (relativePath === "/session/verify") {
    if (method !== "POST") return appNotFound(res), true;
    if (!sessionAuthOn || !["identity", "both"].includes((app as any).session_method ?? "both")) {
      return appNotFound(res), true;
    }
    const ip = clientIp(req);
    if (!checkLimiter(app.id, ip, cfg.login_rate_limit_max, cfg.login_rate_limit_window_min * 60_000)) {
      res.status(429).json({ error: `Too many failed login attempts — try again in ${cfg.login_rate_limit_window_min} minutes`, code: "RATE_LIMITED" });
      return true;
    }
    const { provider_token: token } = (req.body ?? {}) as Record<string, string>;
    if (!token) {
      res.status(400).json({ error: "provider_token is required", code: "VALIDATION_ERROR" });
      return true;
    }
    const issuer = readIssuerFromToken(token);
    const tokenAud = issuer ? readAudienceFromToken(token) : null;
    const provider = issuer ? getProviderByIssuer(issuer, tokenAud ?? undefined) : null;
    if (!issuer || !provider || !provider.is_active) {
      recordFailure(app.id, ip, cfg.login_rate_limit_window_min * 60_000);
      res.status(401).json({ error: "Unknown identity provider", code: "UNKNOWN_PROVIDER" });
      return true;
    }
    const allowed = (app.allowed_provider_ids ?? []).map(String);
    if (allowed.length > 0 && !allowed.includes(String(provider.id))) {
      recordFailure(app.id, ip, cfg.login_rate_limit_window_min * 60_000);
      res.status(401).json({ error: "Provider not allowed for this app", code: "PROVIDER_NOT_ALLOWED_FOR_APP" });
      return true;
    }
    try {
      const principal = await validateToken(token, provider as any);
      mintAndSetCookie(req, res, app, {
        sub: principal.sub,
        email: principal.email,
        issuer: provider.issuer,
        idpToken: token,
      });
    } catch {
      recordFailure(app.id, ip, cfg.login_rate_limit_window_min * 60_000);
      res.status(401).json({ error: "Token verification failed", code: "INVALID_TOKEN" });
    }
    return true;
  }

  // ── Session-bound routes (require a valid session) ──────────────────────────
  const sess = resolveSessionForRequest(req, app);
  if (!sess.ok) {
    res.status(sess.status).json({ error: sess.error, code: sess.code });
    return true;
  }
  const sessionId = sess.principal.sessionId;

  if (relativePath === "/__logout") {
    if (method !== "POST") return appNotFound(res), true;
    appSessionRepo.revoke(db, sessionId);
    res.clearCookie(sessionCookieName(app), { path: "/" });
    res.json({ success: true });
    return true;
  }

  if (relativePath === "/__logout-others") {
    if (method !== "POST") return appNotFound(res), true;
    const revoked = appSessionRepo.revokeOthers(db, app.id, sess.principal.sub, sessionId);
    res.json({ success: true, revoked_devices: revoked });
    return true;
  }

  if (relativePath === "/__me") {
    res.json({
      sub: sess.principal.sub,
      email: sess.principal.email,
      issuer: sess.principal.issuer,
      device_label: sess.principal.deviceLabel,
      bot_ids: sess.principal.botSnapshot,
      ttl_idle_min: cfg.ttl_idle_min,
      max_age_min: cfg.max_age_min,
    });
    return true;
  }

  if (relativePath === "/__devices") {
    const devices = appSessionRepo.listActiveForAppUser(db, app.id, sess.principal.sub)
      .map(d => ({ ...d, is_current: d.id === sessionId }));
    res.json({ devices });
    return true;
  }

  return false;
}
