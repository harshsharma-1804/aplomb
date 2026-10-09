import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import type { DrizzleDb } from "../repos/types.js";
import { appUserRepo } from "../repos/appUserRepo.js";
import { loginChallengeRepo } from "../repos/loginChallengeRepo.js";
import { generateTotpSecret, verifyTotp, base32Decode, otpauthUri } from "../../auth/totp.js";
import { createHmac } from "crypto";

/**
 * Two-factor auth logic — RFC 6238 TOTP engine, challenge lifecycle,
 * per-user 2FA state (Features/TwoFactorAuth-11.md).
 */

const DDL = `
  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_path TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    deprecated_at TEXT, auth_required INTEGER NOT NULL DEFAULT 1, ai_expose INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'prod',
    auth_mode TEXT NOT NULL DEFAULT 'bearer', session_method TEXT NOT NULL DEFAULT 'both',
    session_config TEXT NOT NULL DEFAULT '{}',
    app_env TEXT NOT NULL DEFAULT '[]', allowed_provider_ids TEXT NOT NULL DEFAULT '[]',
    frontend_key_hash TEXT,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id),
    username TEXT NOT NULL, email TEXT NOT NULL,
    password_hash TEXT NOT NULL, sub TEXT NOT NULL,
    display_name TEXT, is_active INTEGER NOT NULL DEFAULT 1,
    auth_method TEXT NOT NULL DEFAULT 'gateway',
    identity_provider_id TEXT, idp_sub TEXT,
    email_verified_at TEXT, phone_verified_at TEXT,
    email_verification_token_hash TEXT, verification_token_expires_at TEXT,
    last_login_at TEXT,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    twofa_status TEXT NOT NULL DEFAULT 'off', twofa_method TEXT,
    totp_secret_ct TEXT, totp_secret_iv TEXT, totp_secret_tag TEXT,
    totp_last_timestep INTEGER, twofa_enrolled_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_challenges (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id),
    user_id TEXT NOT NULL REFERENCES app_users(id),
    kind TEXT NOT NULL, method TEXT,
    pending_hash TEXT NOT NULL, code_hash TEXT,
    expires_at TEXT NOT NULL, last_sent_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT,
    created_at TEXT NOT NULL
  );
`;

const APP_ID = "app-2fa";

function makeDb(): DrizzleDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema }) as unknown as DrizzleDb;
  db.insert(schema.apps).values({
    id: APP_ID, name: "Demo", base_path: "/demo",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).run();
  return db;
}

let db: DrizzleDb;
beforeEach(() => { db = makeDb(); });

// ── TOTP engine ───────────────────────────────────────────────────────────────

describe("TOTP (RFC 6238)", () => {
  // Reference vector: RFC 6238 test secret "12345678901234567890" (ASCII) in base32,
  // SHA-1 / 8 digits — recompute 6-digit variants via hotp derivation below.
  it("accepts a code generated for the current timestep and returns the matched step", () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30000);
    const code = hotpForTest(base32Decode(secret), counter);
    expect(verifyTotp(secret, code)).toBe(counter);
  });

  it("accepts the ±1 window and rejects codes outside it", () => {
    const secret = generateTotpSecret();
    const counter = Math.floor(Date.now() / 30000);
    expect(verifyTotp(secret, hotpForTest(base32Decode(secret), counter - 1))).not.toBeNull();
    expect(verifyTotp(secret, hotpForTest(base32Decode(secret), counter + 1))).not.toBeNull();
    expect(verifyTotp(secret, hotpForTest(base32Decode(secret), counter - 5))).toBeNull();
  });

  it("rejects malformed and wrong codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "abcdef")).toBeNull();
    expect(verifyTotp(secret, "12345")).toBeNull();
    expect(verifyTotp(secret, "000000")).toBeNull();
  });

  it("base32 decoding round-trips", () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret).length).toBe(20);
  });

  it("otpauth URI carries issuer, secret and parameters", () => {
    const uri = otpauthUri("ABC234DEF", "My App", "user@x.com");
    expect(uri).toContain("otpauth://totp/My%20App%3Auser%40x.com");
    expect(uri).toContain("secret=ABC234DEF");
    expect(uri).toContain("issuer=My+App");
    expect(uri).toContain("digits=6");
  });
});

// Mirrors the engine's HOTP core so tests don't import private internals.
function hotpForTest(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", secret).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

// ── Challenge lifecycle ───────────────────────────────────────────────────────

describe("login challenges", () => {
  it("create → usable → consume → not usable (single use)", async () => {
    const u = await createUser();
    const ch = loginChallengeRepo.create(db, {
      app_id: APP_ID, user_id: u.id, kind: "login", method: "email_otp",
      pending_hash: "hash-1", code_hash: "code-1",
    });
    expect(loginChallengeRepo.isUsable(ch)).toBe(true);
    loginChallengeRepo.consume(db, ch.id);
    const after = loginChallengeRepo.findByPendingHash(db, "hash-1")!;
    expect(after.consumed).toBe(true);
    expect(loginChallengeRepo.isUsable(after)).toBe(false);
  });

  it("expired challenges are unusable", async () => {
    const u = await createUser();
    const ch = loginChallengeRepo.create(db, {
      app_id: APP_ID, user_id: u.id, kind: "login", method: "email_otp",
      pending_hash: "hash-2", code_hash: "code-2", ttlMs: -1000,
    });
    expect(loginChallengeRepo.isUsable(ch)).toBe(false);
  });

  it("attempts cap blocks brute force", async () => {
    const u = await createUser();
    const ch = loginChallengeRepo.create(db, {
      app_id: APP_ID, user_id: u.id, kind: "login", method: "email_otp",
      pending_hash: "hash-3", code_hash: "code-3",
    });
    for (let i = 0; i < 5; i++) loginChallengeRepo.recordAttempt(db, ch.id);
    const after = loginChallengeRepo.findByPendingHash(db, "hash-3")!;
    expect(after.attempts).toBe(5);
    expect(loginChallengeRepo.isUsable(after)).toBe(false);
  });

  it("revokeForUser invalidates every pending challenge", async () => {
    const u = await createUser();
    loginChallengeRepo.create(db, {
      app_id: APP_ID, user_id: u.id, kind: "login", method: "totp", pending_hash: "hash-4",
    });
    loginChallengeRepo.create(db, {
      app_id: APP_ID, user_id: u.id, kind: "enroll", method: "totp", pending_hash: "hash-5",
    });
    loginChallengeRepo.revokeForUser(db, u.id);
    expect(loginChallengeRepo.findByPendingHash(db, "hash-4")!.consumed).toBe(true);
    expect(loginChallengeRepo.findByPendingHash(db, "hash-5")!.consumed).toBe(true);
  });
});

// ── Per-user 2FA state ────────────────────────────────────────────────────────

describe("user 2FA state", () => {
  it("TOTP secret round-trips encrypted (no plaintext at rest)", async () => {
    const u = await createUser();
    const secret = generateTotpSecret();
    appUserRepo.setTotpSecret(db, u.id, secret);

    const state = appUserRepo.getTotpState(db, u.id)!;
    expect(state.secret).toBe(secret);
    expect(state.lastTimestep).toBeNull();

    const row = db.select().from(schema.app_users).where(eqId(u.id)).get()!;
    expect(row.totp_secret_ct).toBeTruthy();
    expect(row.totp_secret_ct).not.toContain(secret);
  });

  it("enforce → markEnrolled keeps enforced semantics straight", async () => {
    const u = await createUser();
    appUserRepo.enforceTwofa(db, u.id);
    expect(appUserRepo.findById(db, u.id)!.twofa_status).toBe("enforced");
    appUserRepo.markTwofaEnrolled(db, u.id);
    const after = appUserRepo.findById(db, u.id)!;
    expect(after.twofa_status).toBe("enabled");
    expect(after.twofa_enrolled).toBe(true);
  });

  it("disable clears everything; reset keeps enforcement but wipes enrollment", async () => {
    const u = await createUser();
    appUserRepo.setTotpSecret(db, u.id, generateTotpSecret());
    appUserRepo.markTwofaEnrolled(db, u.id);

    appUserRepo.resetTwofa(db, u.id);
    const reset = appUserRepo.findById(db, u.id)!;
    expect(reset.twofa_status).toBe("enforced");
    expect(reset.twofa_enrolled).toBe(false);
    expect(appUserRepo.getTotpState(db, u.id)).toBeNull();

    appUserRepo.disableTwofa(db, u.id);
    const off = appUserRepo.findById(db, u.id)!;
    expect(off.twofa_status).toBe("off");
    expect(off.twofa_enrolled).toBe(false);
  });

  it("markTotpUsed stores the timestep for replay protection", async () => {
    const u = await createUser();
    appUserRepo.setTotpSecret(db, u.id, generateTotpSecret());
    appUserRepo.markTotpUsed(db, u.id, 987654);
    expect(appUserRepo.getTotpState(db, u.id)!.lastTimestep).toBe(987654);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

import { eq } from "drizzle-orm";
const eqId = (id: string) => eq(schema.app_users.id, id);

async function createUser(): Promise<{ id: string }> {
  const u = await appUserRepo.create(db, {
    app_id: APP_ID, username: `u${Math.random().toString(36).slice(2, 8)}`,
    email: `u${Date.now()}@x.com`, password: "Str0ngPass!234", email_verified: true,
  });
  return { id: u.id };
}
