import type { Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { getDb } from "../db/client.js";
import { appUserRepo } from "../db/repos/appUserRepo.js";
import { resolveSessionConfig } from "../db/repos/appSessionRepo.js";
import { config } from "../config/appConfig.js";
import type { CachedApp } from "../cache/appCache.js";
import { sendMail, verificationEmailHtml, verificationEmailText, MailNotConfiguredError } from "../notify/mailer.js";
import { clientIp } from "./appSessionAuth.js";

/**
 * Gateway self-signup + email verification.
 * See Execution Plan/Orchestrator/specs/IdentityProviderLoginSpecs-3.md
 *
 * Routes (relative to the app's base_path):
 *   POST /signup                     → create an UNVERIFIED user + verification email
 *   GET  /auth/verify?token=…        → browser link; marks verified, 302 to landing
 *   POST /auth/resend-verification   → throttled resend (no user enumeration)
 *
 * Trust model:
 *   - self-signup users start unverified and cannot log in (403 EMAIL_NOT_VERIFIED)
 *   - operator-created users (dashboard Users tab) are trusted immediately
 *   - identity users are verified by construction (IdP email_verified claim)
 *   - phone verification is feature-ready but returns 501 until an SMS provider
 *     is configured (see notify/sms.ts)
 */

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60_000;
const RESEND_WINDOW_MS = 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-memory resend throttle: per app+IP, one per minute.
const lastResend = new Map<string, number>();
// Every sent token bump also debounces per email to stop mailbox spam.
const lastResendEmail = new Map<string, number>();

export function hashVerifyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicOrigin(req: Request): string {
  if (config.orchestrator.publicBaseUrl) return config.orchestrator.publicBaseUrl.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

async function issueVerificationEmail(req: Request, app: CachedApp, user: { id: string; email: string }): Promise<void> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  appUserRepo.setVerificationToken(db, user.id, hashVerifyToken(token), expiresAt);
  const verifyUrl = `${publicOrigin(req)}${app.base_path}/auth/verify?token=${token}`;
  await sendMail({
    purpose: "verification",
    appId: app.id,
    to: user.email,
    subject: `Verify your email — ${app.name}`,
    html: verificationEmailHtml(app.name, verifyUrl, 24),
    text: verificationEmailText(app.name, verifyUrl, 24),
  });
}

/**
 * Dispatch a signup/verification route. Returns true when handled.
 * Called from runtime/router.ts BEFORE endpoint auth — these are unauthenticated.
 */
export async function handleAppSignupRoute(req: Request, res: Response, app: CachedApp, relativePath: string): Promise<boolean> {
  const db = getDb();
  const cfg = resolveSessionConfig(app as any);
  const method = req.method.toUpperCase();
  const authMode = (app as any).auth_mode ?? "bearer";
  const sessionAuthOn = authMode === "session" || authMode === "both";
  const gatewayOn = ["gateway", "both"].includes((app as any).session_method ?? "both");

  const notFound = () => res.status(404).json({ error: "Not found", code: "NOT_FOUND" });

  // ── POST /signup — gateway self-registration ─────────────────────────────────
  if (relativePath === "/signup") {
    if (method !== "POST") { notFound(); return true; }
    if (!sessionAuthOn || !gatewayOn) { notFound(); return true; }

    const ip = clientIp(req);
    const { username, email, password, display_name } = (req.body ?? {}) as Record<string, string>;
    if (!username || !email || !password) {
      res.status(400).json({ error: "username, email and password are required", code: "VALIDATION_ERROR" });
      return true;
    }
    if (!EMAIL_RE.test(email.trim())) {
      res.status(400).json({ error: "A valid email address is required", code: "INVALID_EMAIL" });
      return true;
    }
    if (String(password).length < config.auth.minPasswordLength) {
      res.status(400).json({ error: `Password must be at least ${config.auth.minPasswordLength} characters`, code: "WEAK_PASSWORD" });
      return true;
    }

    // Uniqueness — with specific collision messages (sticky-method aware).
    const uname = username.trim();
    if (appUserRepo.findByUsername(db, app.id, uname)) {
      res.status(409).json({ error: "Username already taken", code: "USERNAME_IN_USE" });
      return true;
    }
    const byEmail = appUserRepo.findByEmail(db, app.id, email);
    if (byEmail) {
      if (byEmail.auth_method === "identity") {
        res.status(409).json({ error: "This email already signs in via an identity provider — use that button", code: "EMAIL_IN_USE_IDENTITY" });
      } else {
        res.status(409).json({ error: "Email already registered", code: "EMAIL_IN_USE" });
      }
      return true;
    }

    const user = await appUserRepo.create(db, {
      app_id: app.id,
      username: uname,
      email,
      password,
      display_name: display_name,
      email_verified: false,          // hard-block until verified (login route enforces)
    });

    try {
      await issueVerificationEmail(req, app, user);
    } catch (e) {
      if (e instanceof MailNotConfiguredError) {
        res.status(503).json({
          error: "Account created, but mail is not configured — an operator must configure SMTP (Admin → Mail) or mark the user verified",
          code: "MAIL_NOT_CONFIGURED",
        });
        return true;
      }
      throw e;
    }
    res.status(201).json({ success: true, email: user.email, verification_required: true });
    return true;
  }

  // ── GET /auth/verify?token=… — browser verification link ─────────────────────
  if (relativePath === "/auth/verify") {
    if (method !== "GET") { notFound(); return true; }
    const token = (req.query["token"] as string) ?? "";
    const verified = token ? appUserRepo.consumeVerificationToken(db, app.id, hashVerifyToken(token)) : null;
    const landing = cfg.post_login_redirect;
    if (verified) {
      if (landing) { res.redirect(`${landing}${landing.includes("?") ? "&" : "?"}verified=1`); }
      else res.status(200).json({ success: true, verified: true });
    } else {
      if (landing) { res.redirect(`${landing}${landing.includes("?") ? "&" : "?"}verified=0`); }
      else res.status(400).json({ error: "Invalid or expired verification link", code: "INVALID_VERIFICATION_TOKEN" });
    }
    return true;
  }

  // ── POST /auth/resend-verification — throttled, no user enumeration ─────────
  if (relativePath === "/auth/resend-verification") {
    if (method !== "POST") { notFound(); return true; }
    if (!sessionAuthOn || !gatewayOn) { notFound(); return true; }
    const { email } = (req.body ?? {}) as Record<string, string>;
    if (!email) {
      res.status(400).json({ error: "email is required", code: "VALIDATION_ERROR" });
      return true;
    }
    const throttleKey = `${app.id}:${clientIp(req)}:${email.trim().toLowerCase()}`;
    const last = lastResendEmail.get(throttleKey) ?? 0;
    if (Date.now() - last < RESEND_WINDOW_MS) {
      res.status(429).json({ error: "Please wait a moment before requesting another email", code: "RATE_LIMITED" });
      return true;
    }
    const user = appUserRepo.findByEmail(db, app.id, email);
    // Always answer success — never reveal whether the account exists.
    if (user && !user.email_verified && user.auth_method === "gateway") {
      try {
        await issueVerificationEmail(req, app, user);
        lastResendEmail.set(throttleKey, Date.now());
      } catch (e) {
        if (e instanceof MailNotConfiguredError) {
          res.status(503).json({ error: "Mail is not configured for this organization", code: "MAIL_NOT_CONFIGURED" });
          return true;
        }
        throw e;
      }
    }
    res.json({ success: true });
    return true;
  }

  return false;
}

export function stopSignupThrottleSweep(): void {
  lastResend.clear();
  lastResendEmail.clear();
}
