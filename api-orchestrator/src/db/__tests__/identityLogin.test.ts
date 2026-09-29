import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import type { DrizzleDb } from "../repos/types.js";
import { appUserRepo } from "../repos/appUserRepo.js";
import { validateRedirect } from "../../auth/oauthBroker.js";

/**
 * Identity-provider login logic — sticky auth method, identity linking,
 * email verification tokens (IdentityProviderLoginSpecs-3.md).
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
    twofa_status TEXT NOT NULL DEFAULT 'off', twofa_method TEXT,
    totp_secret_ct TEXT, totp_secret_iv TEXT, totp_secret_tag TEXT,
    totp_last_timestep INTEGER, twofa_enrolled_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS app_users_app_username_unique ON app_users(app_id, username);
  CREATE UNIQUE INDEX IF NOT EXISTS app_users_app_email_unique ON app_users(app_id, email);
  CREATE UNIQUE INDEX IF NOT EXISTS app_users_app_idp_sub_unique ON app_users(app_id, identity_provider_id, idp_sub);
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

const APP_ID = "app-1";

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

// ── Gateway users ─────────────────────────────────────────────────────────────

describe("gateway users", () => {
  it("operator-created users are trusted immediately and can log in", async () => {
    const u = await appUserRepo.create(db, { app_id: APP_ID, username: "op", email: "op@x.com", password: "Str0ngPass!234", email_verified: true });
    expect(u.email_verified).toBe(true);
    expect(u.auth_method).toBe("gateway");
    const auth = await appUserRepo.verifyCredentials(db, APP_ID, "op", "Str0ngPass!234");
    expect(auth?.id).toBe(u.id);
  });

  it("self-signup users start unverified", async () => {
    const u = await appUserRepo.create(db, { app_id: APP_ID, username: "self", email: "self@x.com", password: "Str0ngPass!234" });
    expect(u.email_verified).toBe(false);
  });

  it("identity-method users can never authenticate with a password", async () => {
    await appUserRepo.createIdentity(db, {
      app_id: APP_ID, identity_provider_id: "prov-1", idp_sub: "google-sub-1",
      email: "idp@x.com", email_verified: true,
    });
    const auth = await appUserRepo.verifyCredentials(db, APP_ID, "idp@x.com", "anything");
    expect(auth).toBeNull();
  });

  it("setPassword is rejected for identity users", async () => {
    const u = await appUserRepo.createIdentity(db, {
      app_id: APP_ID, identity_provider_id: "prov-1", idp_sub: "sub", email: "a@x.com", email_verified: true,
    });
    await expect(appUserRepo.setPassword(db, u.id, "whatever123")).rejects.toThrow("IDENTITY_USER_NO_PASSWORD");
  });
});

// ── Identity users ────────────────────────────────────────────────────────────

describe("identity users", () => {
  it("auto-provision sets sub = idp_sub and derives a username from the email", async () => {
    const u = await appUserRepo.createIdentity(db, {
      app_id: APP_ID, identity_provider_id: "prov-1", idp_sub: "gs1",
      email: "jane.doe@gmail.com", display_name: "Jane", email_verified: true,
    });
    expect(u.sub).toBe("gs1");
    expect(u.username).toBe("jane.doe");
    expect(u.email_verified).toBe(true);
    expect(u.auth_method).toBe("identity");
  });

  it("username collision gets a unique suffix", async () => {
    await appUserRepo.create(db, { app_id: APP_ID, username: "jane.doe", email: "op@x.com", password: "Str0ngPass!234" });
    const u = await appUserRepo.createIdentity(db, {
      app_id: APP_ID, identity_provider_id: "prov-1", idp_sub: "gs1",
      email: "jane.doe@gmail.com", email_verified: true,
    });
    expect(u.username).toMatch(/^jane\.doe\./);
    expect(u.username).not.toBe("jane.doe");
  });

  it("findByIdentity resolves by (app, provider, sub)", async () => {
    const u = await appUserRepo.createIdentity(db, {
      app_id: APP_ID, identity_provider_id: "prov-1", idp_sub: "gs2", email: "x@y.com", email_verified: false,
    });
    expect(appUserRepo.findByIdentity(db, APP_ID, "prov-1", "gs2")?.id).toBe(u.id);
    expect(appUserRepo.findByIdentity(db, APP_ID, "prov-2", "gs2")).toBeNull();
  });
});

// ── Linking (collision matrix) ────────────────────────────────────────────────

describe("identity linking", () => {
  it("attachIdentity links an IdP to an existing gateway user — both methods resolve", async () => {
    const gw = await appUserRepo.create(db, { app_id: APP_ID, username: "jane", email: "jane@x.com", password: "Str0ngPass!234", email_verified: true });
    appUserRepo.attachIdentity(db, gw.id, "prov-1", "gs3");
    const linked = appUserRepo.findByIdentity(db, APP_ID, "prov-1", "gs3");
    expect(linked?.id).toBe(gw.id);
    expect(linked?.auth_method).toBe("gateway");
    // gateway credentials still work on the linked row
    const auth = await appUserRepo.verifyCredentials(db, APP_ID, "jane", "Str0ngPass!234");
    expect(auth?.id).toBe(gw.id);
  });
});

// ── Email verification tokens ─────────────────────────────────────────────────

describe("verification tokens", () => {
  it("consume marks verified, is single-use, and rejects expired tokens", async () => {
    const u = await appUserRepo.create(db, { app_id: APP_ID, username: "v", email: "v@x.com", password: "Str0ngPass!234" });
    appUserRepo.setVerificationToken(db, u.id, "hash-1", new Date(Date.now() + 60_000).toISOString());

    const consumed = appUserRepo.consumeVerificationToken(db, APP_ID, "hash-1");
    expect(consumed?.id).toBe(u.id);
    expect(consumed?.email_verified).toBe(true);

    // token is cleared after use
    expect(appUserRepo.consumeVerificationToken(db, APP_ID, "hash-1")).toBeNull();
  });

  it("expired tokens are rejected", async () => {
    const u = await appUserRepo.create(db, { app_id: APP_ID, username: "v2", email: "v2@x.com", password: "Str0ngPass!234" });
    appUserRepo.setVerificationToken(db, u.id, "hash-2", new Date(Date.now() - 60_000).toISOString());
    expect(appUserRepo.consumeVerificationToken(db, APP_ID, "hash-2")).toBeNull();
  });
});

// ── Redirect allowlist (open-redirect guard) ──────────────────────────────────

describe("validateRedirect", () => {
  const allowlist = ["https://app.example.com", "https://app.example.com/dashboard", "http://localhost:3000"];

  it("accepts exact origins and allowlisted prefixes", () => {
    expect(validateRedirect(allowlist, "https://app.example.com")).toBe("https://app.example.com");
    expect(validateRedirect(allowlist, "https://app.example.com/dashboard?x=1")).toBe("https://app.example.com/dashboard?x=1");
    expect(validateRedirect(allowlist, "http://localhost:3000/anything")).toBe("http://localhost:3000/anything");
  });

  it("accepts any path on a bare-origin entry", () => {
    expect(validateRedirect(allowlist, "https://app.example.com/other")).toBe("https://app.example.com/other");
  });

  it("rejects non-allowlisted origins and paths", () => {
    expect(validateRedirect(allowlist, "https://evil.example.com")).toBeNull();
    expect(validateRedirect(allowlist, "https://app.example.com.evil.com")).toBeNull();
    // prefix entry allows only its own subtree
    expect(validateRedirect(["https://app.example.com/dashboard"], "https://app.example.com/other")).toBeNull();
    expect(validateRedirect([], "https://app.example.com")).toBeNull();
  });

  it("rejects non-http schemes, credentials smuggling, and garbage", () => {
    expect(validateRedirect(allowlist, "javascript:alert(1)")).toBeNull();
    expect(validateRedirect(allowlist, "https://user:pass@app.example.com")).toBeNull();
    expect(validateRedirect(allowlist, "not a url")).toBeNull();
    expect(validateRedirect(allowlist, undefined)).toBeNull();
  });
});
