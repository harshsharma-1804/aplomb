import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import type { DashboardUser } from "./rbac.js";
import { config } from "../config/appConfig.js";

const COOKIE_NAME = config.cookies.name;
const SESSION_TTL_MS = config.session.ttlMs;
const MAX_ATTEMPTS = config.auth.maxFailedAttempts;
const LOCKOUT_MS = config.auth.lockoutDurationMs;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveSession(req: Request): Promise<DashboardUser | null> {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await Session.findOne({
    token_hash: tokenHash,
    revoked_at: null,
    expires_at: { $gt: new Date() },
  }).lean();

  if (!session) return null;

  const user = await User.findById(session.user_id).lean();
  if (!user || !user.is_active) return null;

  return { id: String(user._id), username: user.username, email: user.email, role: user.role };
}

export async function bootstrapAdmin(): Promise<void> {
  const count = await User.countDocuments();
  if (count > 0) return;

  const username = config.auth.bootstrapAdminUsername;
  const password = config.auth.bootstrapAdminPassword;

  if (password.length < config.auth.minPasswordLength) {
    console.warn(`[auth] BOOTSTRAP_ADMIN_PASSWORD is shorter than ${config.auth.minPasswordLength} characters — please change it`);
  }

  const password_hash = await argon2Hash(password);
  await User.create({ username, email: `${username}@localhost`, password_hash, role: "admin", must_change_password: true });
  console.log(`[auth] Bootstrap admin created: ${username} (must change password on first login)`);
}

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const genericError = { error: "Invalid credentials", code: "INVALID_CREDENTIALS" };

  if (!username || !password) {
    res.status(401).json(genericError);
    return;
  }

  try {
    const user = await User.findOne({
      $or: [{ username: username.toLowerCase().trim() }, { email: username.toLowerCase().trim() }],
    });

    if (!user || !user.is_active) {
      res.status(401).json(genericError);
      return;
    }

    if (user.locked_until && user.locked_until > new Date()) {
      res.status(401).json(genericError);
      return;
    }

    const valid = await argon2Verify(user.password_hash, password);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const update: Record<string, unknown> = { failed_login_attempts: attempts };
      if (attempts >= MAX_ATTEMPTS) {
        update["locked_until"] = new Date(Date.now() + LOCKOUT_MS);
      }
      await User.findByIdAndUpdate(user._id, update);
      res.status(401).json(genericError);
      return;
    }

    await User.findByIdAndUpdate(user._id, {
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
    });

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await Session.create({
      user_id: user._id,
      token_hash: tokenHash,
      expires_at: expiresAt,
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
      .json({
        id: String(user._id),
        username: user.username,
        email: user.email,
        role: user.role,
        must_change_password: user.must_change_password,
      });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

authRouter.post("/logout", async (req, res) => {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (token) {
    await Session.findOneAndUpdate({ token_hash: hashToken(token) }, { revoked_at: new Date() }).catch(() => {});
  }
  res.clearCookie(COOKIE_NAME).json({ success: true });
});

authRouter.get("/me", async (req, res) => {
  const user = req.dashboardUser;
  if (!user) {
    res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" });
    return;
  }
  res.json(user);
});

authRouter.post("/change-password", async (req, res) => {
  const user = req.dashboardUser;
  if (!user) { res.status(401).json({ error: "Not authenticated", code: "NOT_AUTHENTICATED" }); return; }

  const { current_password, new_password } = req.body ?? {};
  if (!current_password || !new_password || new_password.length < config.auth.minPasswordLength) {
    res.status(400).json({ error: `new_password must be at least ${config.auth.minPasswordLength} characters`, code: "VALIDATION_ERROR" });
    return;
  }

  const dbUser = await User.findById(user.id);
  if (!dbUser) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  const valid = await argon2Verify(dbUser.password_hash, current_password);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect", code: "INVALID_CREDENTIALS" }); return; }

  const password_hash = await argon2Hash(new_password);
  await User.findByIdAndUpdate(user.id, { password_hash, must_change_password: false });
  res.json({ success: true });
});
