import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import type { CachedApp } from "../cache/appCache.js";
import type { IdentityProvider } from "../db/schema.js";
import { getDb } from "../db/client.js";
import { identityProviderRepo } from "../db/repos/identityProviderRepo.js";
import { appUserRepo } from "../db/repos/appUserRepo.js";
import { resolveSessionConfig } from "../db/repos/appSessionRepo.js";
import type { SessionConfig } from "../db/repos/appRepo.js";
import { resolveSecret } from "../secrets/resolver.js";
import { mintSessionCookie } from "./appSessionAuth.js";
import { getProviderJwks } from "./oidcValidate.js";
import { jwtVerify } from "jose";
import { config } from "../config/appConfig.js";

/**
 * Backend-brokered OAuth2/OIDC login (authorization code + PKCE).
 * See Execution Plan/Orchestrator/specs/IdentityProviderLoginSpecs-3.md
 *
 * The frontend never touches provider credentials: it sends the browser to
 *   GET {base_path}/auth/login/{providerId}?redirect=/dashboard
 * and lands back logged in after
 *   GET {base_path}/auth/callback/{providerId}
 *
 * Security model:
 *   - PKCE (S256) on every flow
 *   - HMAC-signed state bound to app+provider+verifier+redirect, mirrored in a
 *     short-lived HttpOnly cookie — single use, timing-safe compare
 *   - id_token verified against the provider JWKS with audience pinned to client_id
 *   - post-login `redirect` validated against the app's allowlist (no open redirect);
 *     the landing target is taken ONLY from the verified state, never from the query
 *   - all user lookups are parameterised — request values never touch SQL
 */

const STATE_TTL_MS = 5 * 60_000;

// ── OIDC discovery (authorize/token endpoints), cached per issuer ─────────────

type DiscoveryDoc = { authorization_endpoint: string; token_endpoint: string };
const discoveryCache = new Map<string, DiscoveryDoc>();

async function discover(issuer: string): Promise<DiscoveryDoc> {
  const cached = discoveryCache.get(issuer);
  if (cached) return cached;
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`);
  const doc = await res.json() as Partial<DiscoveryDoc>;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error(`OIDC discovery for ${issuer} is missing authorize/token endpoints`);
  }
  const full = doc as DiscoveryDoc;
  discoveryCache.set(issuer, full);
  return full;
}

// ── Redirect allowlist ────────────────────────────────────────────────────────

/**
 * `redirect` must be an absolute URL matching one allowlist entry.
 * Entry may be an exact origin ("https://app.example.com") or origin+prefix
 * ("https://app.example.com/dashboard"). Returns the URL when valid, else null.
 */
export function validateRedirect(allowlist: string[] | undefined, redirect: string | undefined | null): string | null {
  if (!redirect) return null;
  let parsed: URL;
  try { parsed = new URL(redirect); } catch { return null; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  const origin = parsed.origin;
  const path = parsed.pathname.replace(/\/+$/, "") || "";
  for (const entry of allowlist ?? []) {
    let entryUrl: URL;
    try { entryUrl = new URL(entry); } catch { continue; }
    if (entryUrl.origin !== origin) continue;
    const entryPath = entryUrl.pathname.replace(/\/+$/, "");
    if (entryPath === "" || entryPath === "/" || path === entryPath || path.startsWith(`${entryPath}/`)) {
      return redirect;
    }
  }
  return null;
}

// ── State sign/verify (HMAC-SHA256 over a compact JSON payload) ───────────────

type StatePayload = {
  app: string; provider: string; verifier: string;
  redirect: string | null; nonce: string; iat: number;
};

function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", config.session.secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verifyState(state: string): StatePayload | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", config.session.secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (Date.now() - payload.iat > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

function stateCookieName(app: Pick<CachedApp, "base_path" | "session_config">): string {
  const slug = app.base_path.split("/").filter(Boolean).join("_") || "app";
  return `orc_oauth_${slug}`;
}

function publicOrigin(req: Request): string {
  if (config.orchestrator.publicBaseUrl) {
    return config.orchestrator.publicBaseUrl.replace(/\/$/, "");
  }
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

export function callbackUrlFor(req: Request, app: Pick<CachedApp, "base_path">, providerId: string): string {
  return `${publicOrigin(req)}${app.base_path}/auth/callback/${providerId}`;
}

// ── PKCE ──────────────────────────────────────────────────────────────────────

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ── ID-token verification (audience pinned to the broker client_id) ──────────

export type IdTokenClaims = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

async function verifyIdToken(idToken: string, provider: IdentityProvider & { client_id: string | null }): Promise<IdTokenClaims> {
  if (!provider.client_id) throw new Error("provider has no client_id");
  const jwks = await getProviderJwks(provider as any);
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: provider.issuer,
    audience: provider.client_id,
    algorithms: (JSON.parse(provider.algorithms) as string[]) as any,
    clockTolerance: provider.clock_tolerance_sec,
  });
  const raw = payload as Record<string, unknown>;
  return {
    sub: String(raw["sub"] ?? ""),
    email: raw["email"] ? String(raw["email"]) : null,
    emailVerified: raw["email_verified"] === true,
    name: raw["name"] ? String(raw["name"]) : null,
  };
}

// ── Token exchange ────────────────────────────────────────────────────────────

type TokenResponse = { access_token?: string; id_token?: string };

async function exchangeCode(
  provider: IdentityProvider & { client_id: string | null },
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const { token_endpoint } = await discover(provider.issuer);
  const clientSecret = provider.client_secret_ref ? resolveSecret(provider.client_secret_ref) : null;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: provider.client_id ?? "",
    code_verifier: codeVerifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token endpoint ${res.status}: ${detail.slice(0, 200)}`);
  }
  return await res.json() as TokenResponse;
}

// ── Landing helpers ───────────────────────────────────────────────────────────

function landingUrl(redirect: string | null, cfg: SessionConfig, params: Record<string, string>): string {
  const base = redirect ?? cfg.post_login_redirect ?? "";
  if (!base) return "";
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// ── Route dispatch (called from runtime/router.ts — no import cycle) ─────────

/**
 * Reserved app-auth routes for brokered identity login:
 *   GET {base_path}/auth/login/{providerId}    → 302 to the IdP
 *   GET {base_path}/auth/callback/{providerId} → code exchange, session mint, 302 back
 * Live only when session auth is on and the method includes identity — same
 * 404 convention as /login and /session/verify.
 */
export async function handleAppOAuthRoute(req: Request, res: Response, app: CachedApp, relativePath: string): Promise<boolean> {
  const method = req.method.toUpperCase();
  const authMode = (app as any).auth_mode ?? "bearer";
  const sessionAuthOn = authMode === "session" || authMode === "both";
  const identityOn = ["identity", "both"].includes((app as any).session_method ?? "both");

  const loginMatch = relativePath.startsWith("/auth/login/") ? relativePath.slice("/auth/login/".length) : null;
  const callbackMatch = relativePath.startsWith("/auth/callback/") ? relativePath.slice("/auth/callback/".length) : null;
  if (!loginMatch && !callbackMatch) return false;
  if (method !== "GET") { notFound(res); return true; }
  if (!sessionAuthOn || !identityOn) { notFound(res); return true; }

  const providerId = (loginMatch ?? callbackMatch)!.split("/")[0]!;
  const provider = identityProviderRepo.findById(getDb(), providerId);
  if (!provider || !provider.is_active) {
    res.status(404).json({ error: "Unknown identity provider", code: "UNKNOWN_PROVIDER" });
    return true;
  }

  const allowed = (app.allowed_provider_ids ?? []).map(String);
  if (allowed.length > 0 && !allowed.includes(String(provider.id))) {
    res.status(403).json({ error: "Provider not allowed for this app", code: "PROVIDER_NOT_ALLOWED_FOR_APP" });
    return true;
  }

  if (loginMatch) {
    if (!provider.client_id) {
      res.status(400).json({
        error: "Provider is not configured for brokered login (client_id / client secret missing)",
        code: "OAUTH_NOT_CONFIGURED",
      });
      return true;
    }
    await startLogin(req, res, app, provider as IdentityProvider);
    return true;
  }

  await handleCallback(req, res, app, provider as IdentityProvider);
  return true;
}

function notFound(res: Response) {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
}

// ── Login start ───────────────────────────────────────────────────────────────

async function startLogin(req: Request, res: Response, app: CachedApp, provider: IdentityProvider): Promise<void> {
  const cfg = resolveSessionConfig(app as any);
  const requested = (req.query["redirect"] as string) ?? null;
  const redirect = validateRedirect(cfg.login_redirect_allowlist, requested);
  if (requested && !redirect) {
    res.status(400).json({ error: "redirect is not on this app's allowlist", code: "INVALID_REDIRECT" });
    return;
  }

  const redirectUri = callbackUrlFor(req, app, provider.id);
  const { verifier, challenge } = pkcePair();
  const state = signState({
    app: app.id,
    provider: provider.id,
    verifier,
    redirect,
    nonce: randomBytes(16).toString("base64url"),
    iat: Date.now(),
  });

  const authUrl = new URL((await discover(provider.issuer)).authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", provider.client_id ?? "");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", provider.scopes || "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.cookie(stateCookieName(app), state, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_MS,
  });
  res.redirect(authUrl.toString());
}

// ── Callback ──────────────────────────────────────────────────────────────────

/**
 * Complete the authorization-code flow: validate state, exchange the code,
 * verify the ID token, resolve/link/provision the app user, mint the session,
 * redirect to the allowlisted landing page.
 */
async function handleCallback(req: Request, res: Response, app: CachedApp, provider: IdentityProvider): Promise<void> {
  const db = getDb();
  const cfg = resolveSessionConfig(app as any);

  const queryState = (req.query["state"] as string) ?? "";
  const queryCode = (req.query["code"] as string) ?? "";
  const queryError = (req.query["error"] as string) ?? null;

  const land = (state: StatePayload | null, outcome: "success" | "error", code?: string) => {
    res.clearCookie(stateCookieName(app), { path: "/" });
    const target = landingUrl(state?.redirect ?? null, cfg, outcome === "success" ? { login: "success" } : { login: "error", error_code: code ?? "unknown" });
    if (!target) {
      if (outcome === "success") {
        res.status(200).json({ login: "success", code: "SUCCESS" });
      } else {
        res.status(400).json({ login: "error", error: code, code: (code ?? "UNKNOWN").toUpperCase() });
      }
      return;
    }
    res.redirect(target);
  };

  const stateCookie = (req.cookies?.[stateCookieName(app)] as string | undefined) ?? "";
  const state = queryState ? verifyState(queryState) : null;

  if (queryError) { land(state, "error", queryError); return; }
  if (!state || state.app !== app.id || state.provider !== provider.id) { land(state, "error", "state_mismatch"); return; }
  if (!queryCode) { land(state, "error", "missing_code"); return; }
  if (!stateCookie || stateCookie !== queryState) { land(state, "error", "state_mismatch"); return; }
  res.clearCookie(stateCookieName(app), { path: "/" });   // single use — from here on

  try {
    const tokens = await exchangeCode(provider as any, queryCode, callbackUrlFor(req, app, provider.id), state.verifier);
    if (!tokens.id_token) throw new Error("token response has no id_token");
    const claims = await verifyIdToken(tokens.id_token, provider as any);
    if (!claims.sub) throw new Error("id_token has no sub");

    // ── Resolve / link / provision (collision matrix, spec §4) ───────────────
    let user = appUserRepo.findByIdentity(db, app.id, provider.id, claims.sub);
    if (!user && claims.email) {
      const existing = appUserRepo.findByEmail(db, app.id, claims.email);
      if (existing && existing.auth_method === "identity") {
        // Same email already owned by an identity user from a different provider — no merge.
        land(state, "error", "email_conflict"); return;
      }
      if (existing && claims.emailVerified && cfg.link_identity_on_verified_email !== false) {
        // IdP proved email ownership — attach the identity to the existing row.
        appUserRepo.attachIdentity(db, existing.id, provider.id, claims.sub);
        user = existing;
      } else if (existing) {
        land(state, "error", "email_conflict"); return;
      }
    }
    if (!user) {
      user = await appUserRepo.createIdentity(db, {
        app_id: app.id,
        identity_provider_id: provider.id,
        idp_sub: claims.sub,
        email: claims.email ?? `${claims.sub}@${new URL(provider.issuer).hostname}`,
        display_name: claims.name,
        email_verified: claims.emailVerified,
      });
    }
    if (!user.is_active) { land(state, "error", "user_inactive"); return; }

    appUserRepo.touchLogin(db, user.id);

    // Mint the standard orc_sid session (IdP access token encrypted at rest).
    mintSessionCookie(req, res, app, {
      sub: user.sub,
      email: user.email,
      issuer: provider.issuer,
      idpToken: tokens.access_token ?? null,
    });
    land(state, "success");
  } catch (e) {
    console.error(`[oauth] callback failed: app=${app.base_path} provider=${provider.id}:`, (e as Error).message);
    land(state, "error", "token_exchange_failed");
  }
}
