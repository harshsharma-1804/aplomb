import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { getDb } from "../db/client.js";
import { appUserRepo, type SerializedAppUser } from "../db/repos/appUserRepo.js";
import { loginChallengeRepo, OTP_RESEND_WINDOW_MS, CHALLENGE_TTL_MS } from "../db/repos/loginChallengeRepo.js";
import { resolveSessionConfig } from "../db/repos/appSessionRepo.js";
import type { CachedApp } from "../cache/appCache.js";
import { sendMail, otpEmailHtml, otpEmailText, MailNotConfiguredError } from "../notify/mailer.js";
import { mintSessionCookie, resolveSessionForRequest } from "./appSessionAuth.js";
import { generateTotpSecret, verifyTotp, otpauthUri } from "./totp.js";
import { config } from "../config/appConfig.js";

/**
 * User-based two-factor authentication for gateway login.
 * See Features/TwoFactorAuth-11.md and specs/IdentityProviderLoginSpecs-3.md
 *
 * Per-user state (app_users.twofa_status):
 *   'off'      → password-only login (user may self-enroll when allowed)
 *   'enabled'  → user opted in; login requires factor 2
 *   'enforced' → admin required it; login prompts enrollment until enrolled
 *
 * Methods at enrollment: 'totp' (authenticator app) or 'email_otp' (code to
 * the user's email via the "otp" mail route). No backup codes in v1 — admin
 * Reset is the recovery path.
 *
 * pending_token: HMAC-signed certificate that the password (factor 1) was
 * verified for (app, user) — single-use via challenge row, 10-min TTL,
 * timing-safe compare. Same trust pattern as the OAuth state.
 */

const PENDING_TTL_MS = CHALLENGE_TTL_MS;
const OTP_TTL_MIN = 10;

// ── Pending token sign/verify ─────────────────────────────────────────────────

type PendingPayload = { app: string; user: string; challenge: string; iat: number };

function signPending(payload: PendingPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", config.session.secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type PendingChallenge = NonNullable<ReturnType<typeof loginChallengeRepo.findByPendingHash>>;

function verifyPending(token: string, app: CachedApp): { payload: PendingPayload; challenge: PendingChallenge } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", config.session.secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PendingPayload;
    if (payload.app !== app.id) return null;
    if (Date.now() - payload.iat > PENDING_TTL_MS) return null;
    const challenge = loginChallengeRepo.findById(getDb(), payload.challenge);
    if (!challenge) return null;
    // Bind the token to its row: the stored hash must match the FULL signed token.
    const stored = Buffer.from(challenge.pending_hash);
    const computed = Buffer.from(hashToken(token));
    if (stored.length !== computed.length || !timingSafeEqual(stored, computed)) return null;
    return { payload, challenge };
  } catch {
    return null;
  }
}

/**
 * Create a challenge whose pending token is bound to it: the row id is
 * predetermined, the token is signed first, then the row stores the hash of
 * the complete signed token (what verifyPending recomputes).
 */
function issuePending(app: CachedApp, userId: string, kind: "login" | "enroll", method: "totp" | "email_otp" | null, codeHash?: string | null) {
  const challengeId = randomBytes(16).toString("hex");
  const token = signPending({ app: app.id, user: userId, challenge: challengeId, iat: Date.now() });
  const challenge = loginChallengeRepo.create(getDb(), {
    id: challengeId,
    app_id: app.id, user_id: userId, kind, method,
    pending_hash: hashToken(token), code_hash: codeHash ?? null,
  });
  return { token, challenge };
}

// ── User 2FA helpers ──────────────────────────────────────────────────────────

function enrolledMethod(user: SerializedAppUser): "totp" | "email_otp" | null {
  if (!user.twofa_enrolled || !user.twofa_method) return null;
  return user.twofa_method;
}

function respond(res: Response, body: Record<string, unknown>, status = 200): void {
  res.status(status).json(body);
}

// ── Email OTP send ────────────────────────────────────────────────────────────

async function sendOtpEmail(app: CachedApp, user: SerializedAppUser, code: string): Promise<void> {
  await sendMail({
    purpose: "otp",
    appId: app.id,
    to: user.email,
    subject: `Your sign-in code — ${app.name}`,
    html: otpEmailHtml(app.name, code, OTP_TTL_MIN),
    text: otpEmailText(app.name, code, OTP_TTL_MIN),
  });
}

// ── Factor-1 → factor-2 handoff (called from the /login branch) ───────────────

/**
 * After credentials are verified: if this user needs factor 2, create the
 * challenge (sending the email OTP when applicable) and respond — the caller
 * must NOT mint a session in that case. Returns true when it responded.
 */
export async function maybeStartTwoFactor(req: Request, res: Response, app: CachedApp, user: SerializedAppUser): Promise<boolean> {
  const status = user.twofa_status ?? "off";
  if (status === "off") return false;
  const method = enrolledMethod(user);

  if (method) {
    // Enrolled — require factor 2.
    let codeHash: string | null = null;
    if (method === "email_otp") {
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      codeHash = createHash("sha256").update(code).digest("hex");
      try {
        await sendOtpEmail(app, user, code);
      } catch (e) {
        if (e instanceof MailNotConfiguredError) {
          respond(res, { error: "Login codes are sent by email but mail is not configured for this organization", code: "MAIL_NOT_CONFIGURED" }, 503);
          return true;
        }
        throw e;
      }
    }
    const { token } = issuePending(app, user.id, "login", method, codeHash);
    respond(res, {
      twofa_required: true,
      method,
      pending_token: token,
      expires_in_min: OTP_TTL_MIN,
    });
    return true;
  }

  if (status === "enforced") {
    // Admin requires 2FA but the user hasn't enrolled yet — enrollment is the
    // next step (password possession is what the pending token certifies).
    const { token } = issuePending(app, user.id, "login", null);
    respond(res, {
      twofa_required: true,
      method: null,
      enroll_required: true,
      pending_token: token,
      expires_in_min: OTP_TTL_MIN,
    });
    return true;
  }

  return false; // 'off' — caller mints the session
}

// ── Route dispatch (called from runtime/router.ts) ────────────────────────────

export async function handleAppTwoFactorRoute(req: Request, res: Response, app: CachedApp, relativePath: string): Promise<boolean> {
  const method = req.method.toUpperCase();
  const cfg = resolveSessionConfig(app as any);
  const db = getDb();
  const bad = (status: number, error: string, code: string) => respond(res, { error, code }, status);

  const notFound = () => { respond(res, { error: "Not found", code: "NOT_FOUND" }, 404); };

  const requirePost = (): boolean => {
    if (method !== "POST") { notFound(); return false; }
    return true;
  };

  // ── POST /login/2fa — complete login with factor 2 ──────────────────────────
  if (relativePath === "/login/2fa") {
    if (!requirePost()) return true;
    const { pending_token: pendingToken, code } = (req.body ?? {}) as Record<string, string>;
    if (!pendingToken || !code) { bad(400, "pending_token and code are required", "VALIDATION_ERROR"); return true; }
    const resolved = verifyPending(pendingToken, app);
    if (!resolved) { bad(401, "Invalid or expired login attempt — start again", "INVALID_PENDING_TOKEN"); return true; }
    const { payload, challenge } = resolved;
    if (!loginChallengeRepo.isUsable(challenge)) {
      bad(401, challenge.consumed ? "This login attempt was already used" : "Too many attempts or code expired — start again", "CHALLENGE_UNUSABLE");
      return true;
    }
    const user = appUserRepo.findById(db, payload.user);
    if (!user || user.app_id !== app.id) { bad(401, "Invalid or expired login attempt — start again", "INVALID_PENDING_TOKEN"); return true; }

    let ok = false;
    if (challenge.method === "totp") {
      const state = appUserRepo.getTotpState(db, user.id);
      if (state) {
        const matched = verifyTotp(state.secret, code);
        if (matched !== null) {
          // Replay protection: a timestep can only be used once per user.
          if (state.lastTimestep != null && matched <= state.lastTimestep) {
            bad(401, "Code already used — wait for the next one", "TOTP_REPLAYED");
            return true;
          }
          appUserRepo.markTotpUsed(db, user.id, matched);
          ok = true;
        }
      }
    } else if (challenge.method === "email_otp" && challenge.code_hash) {
      const a = Buffer.from(createHash("sha256").update(code.replace(/\s/g, "")).digest("hex"));
      const b = Buffer.from(challenge.code_hash);
      ok = a.length === b.length && timingSafeEqual(a, b);
    }

    if (!ok) {
      loginChallengeRepo.recordAttempt(db, challenge.id);
      bad(401, "Invalid verification code", "INVALID_2FA_CODE");
      return true;
    }

    loginChallengeRepo.consume(db, challenge.id);
    appUserRepo.touchLogin(db, user.id);
    mintSessionCookie(req, res, app, {
      sub: user.sub, email: user.email, issuer: `gateway:${app.id}`,
    });
    respond(res, {
      sub: user.sub, email: user.email,
      twofa_verified: true,
      device_label: (req.headers["user-agent"] ?? "").slice(0, 60) || "Browser",
    });
    return true;
  }

  // ── POST /__2fa/resend — new email OTP for a pending login ──────────────────
  if (relativePath === "/__2fa/resend") {
    if (!requirePost()) return true;
    const { pending_token: pendingToken } = (req.body ?? {}) as Record<string, string>;
    if (!pendingToken) { bad(400, "pending_token is required", "VALIDATION_ERROR"); return true; }
    const resolved = verifyPending(pendingToken, app);
    if (!resolved) { bad(401, "Invalid or expired login attempt — start again", "INVALID_PENDING_TOKEN"); return true; }
    const { payload, challenge } = resolved;
    if (challenge.method !== "email_otp") { bad(400, "Resend is only available for email-code verification", "RESEND_NOT_AVAILABLE"); return true; }
    if (!loginChallengeRepo.isUsable(challenge)) { bad(401, "Too many attempts or code expired — start again", "CHALLENGE_UNUSABLE"); return true; }
    if (challenge.last_sent_at && Date.now() - new Date(challenge.last_sent_at).getTime() < OTP_RESEND_WINDOW_MS) {
      bad(429, "Please wait a moment before requesting another code", "RATE_LIMITED");
      return true;
    }
    const user = appUserRepo.findById(db, payload.user);
    if (!user) { bad(401, "Invalid or expired login attempt — start again", "INVALID_PENDING_TOKEN"); return true; }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await sendOtpEmail(app, user, code);
    } catch (e) {
      if (e instanceof MailNotConfiguredError) { bad(503, "Mail is not configured for this organization", "MAIL_NOT_CONFIGURED"); return true; }
      throw e;
    }
    loginChallengeRepo.rotateCode(db, challenge.id, createHash("sha256").update(code).digest("hex"));
    respond(res, { success: true, expires_in_min: OTP_TTL_MIN });
    return true;
  }

  // ── POST /__2fa/enroll — start enrollment (session or pending login) ────────
  if (relativePath === "/__2fa/enroll") {
    if (!requirePost()) return true;
    const { method: enrollMethod, pending_token: pendingToken } = (req.body ?? {}) as Record<string, string>;

    let targetUser: SerializedAppUser | null = null;
    if (pendingToken) {
      // Enrollment-gated login (admin-enforced, not yet enrolled).
      const resolved = verifyPending(pendingToken, app);
      if (!resolved) { bad(401, "Invalid or expired login attempt — start again", "INVALID_PENDING_TOKEN"); return true; }
      if (!loginChallengeRepo.isUsable(resolved.challenge) || resolved.challenge.kind !== "login") {
        bad(401, "Invalid or expired login attempt — start again", "CHALLENGE_UNUSABLE"); return true;
      }
      targetUser = appUserRepo.findById(db, resolved.payload.user);
    } else {
      // Self-service enrollment — requires an active gateway session.
      const sess = resolveSessionForRequest(req, app);
      if (!sess.ok) { bad(401, sess.error, sess.code); return true; }
      if (!sess.principal.issuer.startsWith("gateway:")) {
        bad(400, "Two-factor enrollment applies to gateway users only", "NOT_GATEWAY_SESSION"); return true;
      }
      if (cfg.twofa_available === false) {
        bad(403, "Two-factor enrollment is disabled for this app", "TWOFA_DISABLED"); return true;
      }
      targetUser = appUserRepo.listByApp(db, app.id).find(u => u.sub === sess.principal.sub && u.auth_method === "gateway") ?? null;
    }
    if (!targetUser) { bad(404, "User not found", "NOT_FOUND"); return true; }
    if (targetUser.twofa_status === "enabled" || enrolledMethod(targetUser)) {
      bad(409, "Two-factor is already set up for this account", "ALREADY_ENROLLED"); return true;
    }

    const method = enrollMethod === "totp" ? "totp" : enrollMethod === "email_otp" ? "email_otp" : null;
    if (!method) { bad(400, "method must be 'totp' or 'email_otp'", "VALIDATION_ERROR"); return true; }

    let totpSecret: string | null = null;
    let emailCodeHash: string | null = null;

    if (method === "totp") {
      const secret = generateTotpSecret();
      appUserRepo.setTotpSecret(db, targetUser.id, secret);
      totpSecret = secret;
    } else {
      appUserRepo.setTwofaMethod(db, targetUser.id, "email_otp");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      emailCodeHash = createHash("sha256").update(code).digest("hex");
      try {
        await sendOtpEmail(app, targetUser, code);
      } catch (e) {
        if (e instanceof MailNotConfiguredError) { bad(503, "Enrollment codes are sent by email but mail is not configured for this organization", "MAIL_NOT_CONFIGURED"); return true; }
        throw e;
      }
    }

    const { token } = issuePending(app, targetUser.id, "enroll", method, emailCodeHash);

    const body: Record<string, unknown> = { method, pending_token: token };
    if (method === "totp") {
      body["secret"] = totpSecret;
      body["otpauth_uri"] = otpauthUri(totpSecret!, app.name, targetUser.email);
    } else {
      body["sent_to"] = targetUser.email;
    }
    respond(res, body);
    return true;
  }

  // ── POST /__2fa/confirm — finish enrollment with the first code ─────────────
  if (relativePath === "/__2fa/confirm") {
    if (!requirePost()) return true;
    const { pending_token: pendingToken, code } = (req.body ?? {}) as Record<string, string>;
    if (!pendingToken || !code) { bad(400, "pending_token and code are required", "VALIDATION_ERROR"); return true; }
    const resolved = verifyPending(pendingToken, app);
    if (!resolved) { bad(401, "Invalid or expired enrollment — start again", "INVALID_PENDING_TOKEN"); return true; }
    const { payload, challenge } = resolved;
    if (challenge.kind !== "enroll" || !loginChallengeRepo.isUsable(challenge)) {
      bad(401, "Invalid or expired enrollment — start again", "CHALLENGE_UNUSABLE"); return true;
    }
    const user = appUserRepo.findById(db, payload.user);
    if (!user || user.app_id !== app.id) { bad(401, "Invalid or expired enrollment — start again", "INVALID_PENDING_TOKEN"); return true; }

    let ok = false;
    if (challenge.method === "totp") {
      const state = appUserRepo.getTotpState(db, user.id);
      ok = state ? verifyTotp(state.secret, code) !== null : false;
    } else if (challenge.method === "email_otp" && challenge.code_hash) {
      const a = Buffer.from(createHash("sha256").update(code.replace(/\s/g, "")).digest("hex"));
      const b = Buffer.from(challenge.code_hash);
      ok = a.length === b.length && timingSafeEqual(a, b);
    }
    if (!ok) {
      loginChallengeRepo.recordAttempt(db, challenge.id);
      bad(401, "Invalid verification code", "INVALID_2FA_CODE");
      return true;
    }

    loginChallengeRepo.consume(db, challenge.id);
    appUserRepo.markTwofaEnrolled(db, user.id);
    loginChallengeRepo.revokeForUser(db, user.id);   // stale login challenges die with the new state

    // If this confirmation came from an enrollment-gated login (admin-enforced,
    // no session yet), mint the session now. If the user was already logged in,
    // the existing session stays valid.
    const sess = resolveSessionForRequest(req, app);
    if (!sess.ok || sess.principal.sub !== user.sub) {
      mintSessionCookie(req, res, app, { sub: user.sub, email: user.email, issuer: `gateway:${app.id}` });
      respond(res, { enrolled: true, method: challenge.method, session_minted: true });
      return true;
    }
    respond(res, { enrolled: true, method: challenge.method, session_minted: false });
    return true;
  }

  // ── GET /__2fa/status — enrollment state for the logged-in user ─────────────
  if (relativePath === "/__2fa/status") {
    if (method !== "GET") { notFound(); return true; }
    const sess = resolveSessionForRequest(req, app);
    if (!sess.ok) { bad(401, sess.error, sess.code); return true; }
    const user = appUserRepo.listByApp(db, app.id).find(u => u.sub === sess.principal.sub && u.auth_method === "gateway");
    respond(res, {
      twofa_status: user?.twofa_status ?? "off",
      method: user?.twofa_method ?? null,
      enrolled: Boolean(user?.twofa_enrolled),
      enrollment_allowed: cfg.twofa_available !== false,
    });
    return true;
  }

  return false;
}

// ── Housekeeping (called from index.ts alongside the session purge) ───────────

export function purgeLoginChallenges(): number {
  return loginChallengeRepo.purge(getDb());
}
