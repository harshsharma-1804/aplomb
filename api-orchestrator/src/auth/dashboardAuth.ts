import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { getDb } from "../db/client.js";
import { userRepo } from "../db/repos/userRepo.js";
import { sessionRepo } from "../db/repos/sessionRepo.js";
import type { DashboardUser } from "./rbac.js";
import { config } from "../config/appConfig.js";

const COOKIE_NAME = config.cookies.name;
const SESSION_TTL_MS = config.session.ttlMs;
const MAX_ATTEMPTS = config.auth.maxFailedAttempts;
const LOCKOUT_MS = config.auth.lockoutDurationMs;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function resolveSession(req: Request): DashboardUser | null {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) return null;

  const db = getDb();
  const tokenHash = hashToken(token);
  const session = sessionRepo.findByTokenHash(db, tokenHash);

  if (!session) return null;
  if (session.revoked_at) return null;
  if (new Date(session.expires_at) <= new Date()) return null;

  const user = userRepo.findById(db, session.user_id);
  if (!user || !user.is_active) return null;

  return { id: user.id, username: user.username, email: user.email, role: user.role as DashboardUser["role"] };
}

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const genericError = { error: "Invalid credentials", code: "INVALID_CREDENTIALS" };

  if (!username || !password) { res.status(401).json(genericError); return; }

  try {
    const db = getDb();
    const cleaned = username.toLowerCase().trim();
    const user = userRepo.findByUsername(db, cleaned) ?? userRepo.findByEmail(db, cleaned);

    if (!user || !user.is_active) { res.status(401).json(genericError); return; }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      res.status(401).json(genericError); return;
    }

    const valid = await argon2Verify(user.password_hash, password);
    if (!valid) {
      userRepo.incrementFailedAttempts(db, user.id);
      const updated = userRepo.findById(db, user.id)!;
      if (updated.failed_login_attempts >= MAX_ATTEMPTS) {
        userRepo.setLockout(db, user.id, new Date(Date.now() + LOCKOUT_MS));
      }
      res.status(401).json(genericError); return;
    }

    userRepo.resetFailedAttempts(db, user.id);
    userRepo.setLastLogin(db, user.id);

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    sessionRepo.create(db, {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      ip: req.ip ?? "",
      user_agent: req.headers["user-agent"] ?? "",
    });

    res
      .cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.cookies.secure,
        sameSite: config.cookies.sameSite,
        expires: expiresAt,
      })
      .json({ id: user.id, username: user.username, email: user.email, role: user.role, must_change_password: user.must_change_password });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

authRouter.post("/logout", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (token) {
    try {
      const db = getDb();
      const session = sessionRepo.findByTokenHash(db, hashToken(token));
      if (session) sessionRepo.revoke(db, session.id);
    } catch {}
  }
  res.clearCookie(COOKIE_NAME).json({ success: true });
});

authRouter.get("/me", (req, res) => {
  if (!req.dashboardUser) { res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" }); return; }
  res.json(req.dashboardUser);
});

authRouter.post("/change-password", async (req, res) => {
  const user = req.dashboardUser;
  if (!user) { res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" }); return; }

  const { current_password, new_password } = req.body ?? {};
  if (!current_password || !new_password || new_password.length < config.auth.minPasswordLength) {
    res.status(400).json({ error: `new_password must be at least ${config.auth.minPasswordLength} characters`, code: "VALIDATION_ERROR" }); return;
  }

  const db = getDb();
  const dbUser = userRepo.findById(db, user.id);
  if (!dbUser) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  const valid = await argon2Verify(dbUser.password_hash, current_password);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect", code: "INVALID_CREDENTIALS" }); return; }

  const password_hash = await argon2Hash(new_password);
  userRepo.updatePassword(db, user.id, password_hash);
  res.json({ success: true });
});
