import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "../client.js";
import { login_challenges, type LoginChallenge } from "../schema.js";
import type { DrizzleDb } from "./types.js";

/**
 * Step-up state between password (factor 1) and factor 2 during gateway login,
 * plus 2FA enrollment confirmations. See Features/TwoFactorAuth-11.md
 *
 * The client holds an HMAC-signed pending token; this table holds the SHA-256
 * hash of that token (single use), the hashed email-OTP code, TTL, attempts.
 */

export const CHALLENGE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const OTP_RESEND_WINDOW_MS = 60_000;

export type ChallengeKind = "login" | "enroll";
export type ChallengeMethod = "totp" | "email_otp";

function serialize(row: LoginChallenge) {
  return {
    id: row.id,
    app_id: row.app_id,
    user_id: row.user_id,
    kind: row.kind as ChallengeKind,
    method: (row.method as ChallengeMethod | null) ?? null,
    pending_hash: row.pending_hash,
    code_hash: row.code_hash ?? null,   // SHA-256 — safe to expose internally
    expires_at: row.expires_at,
    attempts: row.attempts,
    consumed: Boolean(row.consumed_at),
    last_sent_at: row.last_sent_at ?? null,
  };
}

export const loginChallengeRepo = {
  create(db: DrizzleDb, input: {
    id?: string;
    app_id: string; user_id: string; kind: ChallengeKind;
    method: ChallengeMethod | null; pending_hash: string; code_hash?: string | null;
    ttlMs?: number;
  }): ReturnType<typeof serialize> {
    const id = input.id ?? randomUUID();
    const t = new Date().toISOString();
    const now = Date.now();
    db.insert(login_challenges).values({
      id,
      app_id: input.app_id,
      user_id: input.user_id,
      kind: input.kind,
      method: input.method,
      pending_hash: input.pending_hash,
      code_hash: input.code_hash ?? null,
      expires_at: new Date(now + (input.ttlMs ?? CHALLENGE_TTL_MS)).toISOString(),
      last_sent_at: input.code_hash ? t : null,
      created_at: t,
    }).run();
    return serialize(db.select().from(login_challenges).where(eq(login_challenges.id, id)).get()!);
  },

  findByPendingHash(db: DrizzleDb, pendingHash: string): ReturnType<typeof serialize> | null {
    const row = db.select().from(login_challenges).where(eq(login_challenges.pending_hash, pendingHash)).get();
    return row ? serialize(row) : null;
  },

  findById(db: DrizzleDb, id: string): ReturnType<typeof serialize> | null {
    const row = db.select().from(login_challenges).where(eq(login_challenges.id, id)).get();
    return row ? serialize(row) : null;
  },

  /** True when the challenge is usable: unconsumed, unexpired, attempts left. */
  isUsable(ch: ReturnType<typeof serialize>): boolean {
    return !ch.consumed && ch.expires_at > new Date().toISOString() && ch.attempts < MAX_ATTEMPTS;
  },

  recordAttempt(db: DrizzleDb, id: string): void {
    db.update(login_challenges).set({
      attempts: sql`${login_challenges.attempts} + 1`,
    }).where(eq(login_challenges.id, id)).run();
  },

  consume(db: DrizzleDb, id: string): void {
    db.update(login_challenges).set({ consumed_at: new Date().toISOString() })
      .where(eq(login_challenges.id, id)).run();
  },

  /** Replace the OTP code (resend) — refreshes TTL and last_sent_at. */
  rotateCode(db: DrizzleDb, id: string, codeHash: string): void {
    const t = new Date().toISOString();
    db.update(login_challenges).set({
      code_hash: codeHash,
      last_sent_at: t,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      attempts: 0,
    }).where(eq(login_challenges.id, id)).run();
  },

  /** Purge expired/consumed challenges older than a day (housekeeping). */
  purge(db: DrizzleDb): number {
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    const r = db.delete(login_challenges)
      .where(or(lt(login_challenges.expires_at, cutoff), sql`${login_challenges.consumed_at} IS NOT NULL`))
      .run();
    return r.changes;
  },

  /** Invalidate every pending challenge for a user (admin reset/disable). */
  revokeForUser(db: DrizzleDb, userId: string): void {
    db.update(login_challenges).set({ consumed_at: new Date().toISOString() })
      .where(and(eq(login_challenges.user_id, userId), isNull(login_challenges.consumed_at)))
      .run();
  },
};
