import { and, eq, or } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { app_users, type AppUser } from "../schema.js";
import type { DrizzleDb } from "./types.js";
import { encryptSecret, decryptRaw } from "../../secrets/resolver.js";

/**
 * Per-app gateway-auth users. Completely disjoint from `users` (dashboard admins):
 * every query here filters by app_id, and dashboard auth never reads this table.
 * See Execution Plan/Orchestrator/Features/AppScopedSessions-9.md and
 * Execution Plan/Orchestrator/specs/IdentityProviderLoginSpecs-3.md
 *
 * Sticky auth method: a row's `auth_method` is fixed at creation —
 *   'gateway'  → password login only (self-signup requires email verification)
 *   'identity' → IdP redirect login only (no usable password is ever stored)
 * A gateway user MAY additionally carry an identity (attached only when email
 * ownership is proven on both sides — see the collision matrix in the spec),
 * in which case both methods open the same row.
 */

export type SerializedAppUser = {
  id: string; app_id: string; username: string; email: string;
  sub: string; display_name: string | null; is_active: boolean;
  auth_method: "gateway" | "identity";
  identity_provider_id: string | null;
  idp_sub: string | null;
  email_verified: boolean;
  last_login_at: string | null;
  // Username-level lockout
  failed_login_attempts: number;
  locked_until: string | null;
  is_locked: boolean;
  // Two-factor (see Features/TwoFactorAuth-11.md)
  twofa_status: "off" | "enabled" | "enforced";
  twofa_method: "totp" | "email_otp" | null;
  twofa_enrolled: boolean;
  created_at: string; updated_at: string;
};

export type CreateAppUserInput = {
  app_id: string;
  username: string;
  email: string;
  password: string;
  /**
   * Verified identity bound into the session (e.g. a member ID on
   * member-scoped apps). Optional — defaults to the username for apps
   * whose users have no external identity (e.g. admin consoles).
   */
  sub?: string;
  display_name?: string;
  /** Self-signup rows start unverified and cannot log in until verified. */
  email_verified?: boolean;
};

export type CreateIdentityUserInput = {
  app_id: string;
  identity_provider_id: string;
  idp_sub: string;
  email: string;
  display_name?: string | null;
  /** True when the IdP asserts email_verified on the ID token. */
  email_verified: boolean;
};

function serialize(row: AppUser): SerializedAppUser {
  return {
    id: row.id,
    app_id: row.app_id,
    username: row.username,
    email: row.email,
    sub: row.sub,
    display_name: row.display_name,
    is_active: Boolean(row.is_active),
    auth_method: (row.auth_method as "gateway" | "identity") ?? "gateway",
    identity_provider_id: row.identity_provider_id ?? null,
    idp_sub: row.idp_sub ?? null,
    email_verified: Boolean(row.email_verified_at),
    last_login_at: row.last_login_at ?? null,
    failed_login_attempts: row.failed_login_attempts ?? 0,
    locked_until: row.locked_until ?? null,
    is_locked: Boolean(row.locked_until && row.locked_until > new Date().toISOString()),
    twofa_status: (row.twofa_status as "off" | "enabled" | "enforced") ?? "off",
    twofa_method: (row.twofa_method as "totp" | "email_otp" | null) ?? null,
    twofa_enrolled: Boolean(row.twofa_enrolled_at),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const appUserRepo = {
  async create(db: DrizzleDb, input: CreateAppUserInput): Promise<SerializedAppUser> {
    const id = randomUUID();
    const t = new Date().toISOString();
    const password_hash = await argon2Hash(input.password);
    db.insert(app_users).values({
      id,
      app_id: input.app_id,
      username: input.username.trim(),
      email: input.email.trim().toLowerCase(),
      password_hash,
      sub: input.sub?.trim() || input.username.trim(),
      display_name: input.display_name ?? null,
      is_active: true,
      auth_method: "gateway",
      email_verified_at: input.email_verified ? t : null,
      created_at: t,
      updated_at: t,
    }).run();
    return serialize(db.select().from(app_users).where(eq(app_users.id, id)).get()!);
  },

  /** Auto-provisioned / linked identity user. Session sub = idp_sub. */
  async createIdentity(db: DrizzleDb, input: CreateIdentityUserInput): Promise<SerializedAppUser> {
    const id = randomUUID();
    const t = new Date().toISOString();
    const password_hash = await argon2Hash(randomBytes(32).toString("base64url"));
    // Derive a unique username from the email local-part; suffix on collision.
    const base = (input.email.split("@")[0] || "user").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "user";
    let username = base;
    for (let i = 0; i < 5; i++) {
      const clash = db.select().from(app_users)
        .where(and(eq(app_users.app_id, input.app_id), eq(app_users.username, username))).get();
      if (!clash) break;
      username = `${base}.${randomBytes(2).toString("hex")}`;
    }
    db.insert(app_users).values({
      id,
      app_id: input.app_id,
      username,
      email: input.email.trim().toLowerCase(),
      password_hash,
      sub: input.idp_sub,
      display_name: input.display_name ?? null,
      is_active: true,
      auth_method: "identity",
      identity_provider_id: input.identity_provider_id,
      idp_sub: input.idp_sub,
      email_verified_at: input.email_verified ? t : null,
      created_at: t,
      updated_at: t,
    }).run();
    return serialize(db.select().from(app_users).where(eq(app_users.id, id)).get()!);
  },

  /** Attach a proven identity to an existing (gateway) user row — link, never merge rows. */
  attachIdentity(db: DrizzleDb, id: string, identity_provider_id: string, idp_sub: string): void {
    db.update(app_users).set({
      identity_provider_id, idp_sub, updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  async setPassword(db: DrizzleDb, id: string, password: string): Promise<void> {
    const row = db.select().from(app_users).where(eq(app_users.id, id)).get();
    if (row && row.auth_method === "identity") {
      throw new Error("IDENTITY_USER_NO_PASSWORD");
    }
    const password_hash = await argon2Hash(password);
    db.update(app_users).set({ password_hash, updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean): void {
    db.update(app_users).set({ is_active, updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  update(db: DrizzleDb, id: string, patch: { display_name?: string; email?: string; sub?: string }): void {
    const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.display_name !== undefined) p["display_name"] = patch.display_name;
    if (patch.email !== undefined) p["email"] = patch.email.trim().toLowerCase();
    if (patch.sub !== undefined) p["sub"] = patch.sub.trim();
    db.update(app_users).set(p).where(eq(app_users.id, id)).run();
  },

  delete(db: DrizzleDb, id: string): void {
    db.delete(app_users).where(eq(app_users.id, id)).run();
  },

  listByApp(db: DrizzleDb, appId: string): SerializedAppUser[] {
    return db.select().from(app_users).where(eq(app_users.app_id, appId)).all().map(serialize);
  },

  findById(db: DrizzleDb, id: string): SerializedAppUser | null {
    const row = db.select().from(app_users).where(eq(app_users.id, id)).get();
    return row ? serialize(row) : null;
  },

  findByIdentity(db: DrizzleDb, appId: string, identityProviderId: string, idpSub: string): SerializedAppUser | null {
    const row = db.select().from(app_users).where(and(
      eq(app_users.app_id, appId),
      eq(app_users.identity_provider_id, identityProviderId),
      eq(app_users.idp_sub, idpSub),
    )).get();
    return row ? serialize(row) : null;
  },

  findByEmail(db: DrizzleDb, appId: string, email: string): SerializedAppUser | null {
    const row = db.select().from(app_users).where(and(
      eq(app_users.app_id, appId),
      eq(app_users.email, email.trim().toLowerCase()),
    )).get();
    return row ? serialize(row) : null;
  },

  findByUsername(db: DrizzleDb, appId: string, username: string): SerializedAppUser | null {
    const row = db.select().from(app_users).where(and(
      eq(app_users.app_id, appId),
      eq(app_users.username, username.trim()),
    )).get();
    return row ? serialize(row) : null;
  },

  // ── Email verification (gateway self-signup) ────────────────────────────────

  setVerificationToken(db: DrizzleDb, id: string, tokenHash: string, expiresAt: string): void {
    db.update(app_users).set({
      email_verification_token_hash: tokenHash,
      verification_token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  /** Consume a verification token — single use, expiry enforced. Returns the user or null. */
  consumeVerificationToken(db: DrizzleDb, appId: string, tokenHash: string): SerializedAppUser | null {
    const row = db.select().from(app_users).where(and(
      eq(app_users.app_id, appId),
      eq(app_users.email_verification_token_hash, tokenHash),
    )).get();
    if (!row) return null;
    if (row.verification_token_expires_at && row.verification_token_expires_at <= new Date().toISOString()) {
      return null;
    }
    db.update(app_users).set({
      email_verified_at: new Date().toISOString(),
      email_verification_token_hash: null,
      verification_token_expires_at: null,
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, row.id)).run();
    return serialize(db.select().from(app_users).where(eq(app_users.id, row.id)).get()!);
  },

  touchLogin(db: DrizzleDb, id: string): void {
    db.update(app_users).set({
      last_login_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    }).where(eq(app_users.id, id)).run();
  },

  // ── Username-level lockout ────────────────────────────────────────────────────

  /** Record a failed attempt. Locks the account when max is reached. Returns the updated row. */
  recordLoginFailure(db: DrizzleDb, id: string, maxAttempts: number, lockDurationMs: number): SerializedAppUser {
    const row = db.select().from(app_users).where(eq(app_users.id, id)).get()!;
    const attempts = (row.failed_login_attempts ?? 0) + 1;
    const patch: Record<string, unknown> = {
      failed_login_attempts: attempts,
      updated_at: new Date().toISOString(),
    };
    if (attempts >= maxAttempts) {
      patch["locked_until"] = new Date(Date.now() + lockDurationMs).toISOString();
    }
    db.update(app_users).set(patch).where(eq(app_users.id, id)).run();
    return serialize(db.select().from(app_users).where(eq(app_users.id, id)).get()!);
  },

  /** Admin unlock — clears the lockout and resets the failure counter. */
  unlock(db: DrizzleDb, id: string): void {
    db.update(app_users).set({
      failed_login_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  // ── Two-factor state (Features/TwoFactorAuth-11.md) ─────────────────────────

  /** Decrypted TOTP secret + last-used timestep, or null when not stored. */
  getTotpState(db: DrizzleDb, id: string): { secret: string; lastTimestep: number | null } | null {
    const row = db.select().from(app_users).where(eq(app_users.id, id)).get();
    if (!row?.totp_secret_ct || !row.totp_secret_iv || !row.totp_secret_tag) return null;
    return {
      secret: decryptRaw(row.totp_secret_ct, row.totp_secret_iv, row.totp_secret_tag),
      lastTimestep: row.totp_last_timestep ?? null,
    };
  },

  /** Store the (base32) TOTP secret — AES-256-GCM encrypted at rest. */
  setTotpSecret(db: DrizzleDb, id: string, secret: string): void {
    const enc = encryptSecret(secret);
    db.update(app_users).set({
      twofa_method: "totp",
      totp_secret_ct: enc.ciphertext, totp_secret_iv: enc.iv, totp_secret_tag: enc.auth_tag,
      totp_last_timestep: null,
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  setTwofaMethod(db: DrizzleDb, id: string, method: "totp" | "email_otp"): void {
    db.update(app_users).set({ twofa_method: method, updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  /** Mark enrollment complete (keeps 'enforced' status if the admin set it). */
  markTwofaEnrolled(db: DrizzleDb, id: string): void {
    db.update(app_users).set({
      twofa_status: "enabled",
      twofa_enrolled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  markTotpUsed(db: DrizzleDb, id: string, timestep: number): void {
    db.update(app_users).set({ totp_last_timestep: timestep, updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  /** Admin: require 2FA at this user's next login. */
  enforceTwofa(db: DrizzleDb, id: string): void {
    db.update(app_users).set({ twofa_status: "enforced", updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  /** Admin: turn 2FA off — clears method, secret and enrollment. */
  disableTwofa(db: DrizzleDb, id: string): void {
    db.update(app_users).set({
      twofa_status: "off", twofa_method: null,
      totp_secret_ct: null, totp_secret_iv: null, totp_secret_tag: null,
      totp_last_timestep: null, twofa_enrolled_at: null,
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  /** Admin: wipe enrollment but keep enforcement — the user re-enrolls at next login. */
  resetTwofa(db: DrizzleDb, id: string): void {
    db.update(app_users).set({
      twofa_status: "enforced", twofa_method: null,
      totp_secret_ct: null, totp_secret_iv: null, totp_secret_tag: null,
      totp_last_timestep: null, twofa_enrolled_at: null,
      updated_at: new Date().toISOString(),
    }).where(eq(app_users.id, id)).run();
  },

  /**
   * Gateway credential verification. Looks ONLY within this app's user set —
   * an admin's dashboard credentials can never authenticate here, and this
   * user can never authenticate to the dashboard (disjoint stores).
   * Identity-method users are rejected even if a linked row exists — the
   * sticky-method rule keeps the two worlds separate.
   */
  async verifyCredentials(db: DrizzleDb, appId: string, identifier: string, password: string): Promise<SerializedAppUser | null> {
    const ident = identifier.trim();
    const row = db.select().from(app_users).where(and(
      eq(app_users.app_id, appId),
      or(eq(app_users.username, ident), eq(app_users.email, ident.toLowerCase())),
    )).get();
    if (!row || !row.is_active) return null;
    if (row.auth_method === "identity") return null;
    const ok = await argon2Verify(row.password_hash, password);
    return ok ? serialize(row) : null;
  },
};
