import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import type { DrizzleDb } from "../repos/types.js";
import { userRepo } from "../repos/userRepo.js";
import { sessionRepo } from "../repos/sessionRepo.js";
import { appRepo } from "../repos/appRepo.js";
import { endpointRepo } from "../repos/endpointRepo.js";
import { secretRepo } from "../repos/secretRepo.js";

const DDL = `
  CREATE TABLE IF NOT EXISTS organization (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
    is_active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT, last_login_at TEXT, created_by TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
    ip TEXT DEFAULT '', user_agent TEXT DEFAULT '',
    revoked_at TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT DEFAULT '',
    ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
    created_by TEXT, rotated_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS identity_providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'oidc',
    issuer TEXT NOT NULL UNIQUE, jwks_uri TEXT,
    audience TEXT NOT NULL DEFAULT '[]', algorithms TEXT NOT NULL DEFAULT '["RS256"]',
    claim_mappings TEXT NOT NULL DEFAULT '{}',
    clock_tolerance_sec INTEGER NOT NULL DEFAULT 60,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS host_allowlist (
    id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE, description TEXT DEFAULT '',
    is_wildcard INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, base_path TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
    deprecated_at TEXT, auth_required INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'prod',
    app_env TEXT NOT NULL DEFAULT '[]',
    allowed_provider_ids TEXT NOT NULL DEFAULT '[]',
    created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS endpoints (
    id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id),
    name TEXT NOT NULL, description TEXT DEFAULT '',
    method TEXT NOT NULL, path TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    script_mode TEXT NOT NULL DEFAULT 'none', script_file_id TEXT,
    path_params TEXT NOT NULL DEFAULT '[]', query_params TEXT NOT NULL DEFAULT '[]',
    request TEXT NOT NULL DEFAULT '{}', upstream TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '[]', field_mappings TEXT NOT NULL DEFAULT '[]',
    sample_response TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(app_id, method, path)
  );
  CREATE INDEX IF NOT EXISTS idx_endpoints_app_id ON endpoints(app_id);
  CREATE TABLE IF NOT EXISTS app_scripts (
    id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id),
    filename TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'javascript',
    source TEXT NOT NULL DEFAULT '', compiled TEXT, description TEXT DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(app_id, filename)
  );
  CREATE TABLE IF NOT EXISTS version_history (
    id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id),
    change_type TEXT NOT NULL, changed_by TEXT NOT NULL DEFAULT '{}',
    description TEXT DEFAULT '', snapshot TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
`;

function makeDb(): DrizzleDb {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  return drizzle(sqlite, { schema }) as unknown as DrizzleDb;
}

// ── userRepo ──────────────────────────────────────────────────────────────────

describe("userRepo", () => {
  it("creates and finds user by username", () => {
    const db = makeDb();
    userRepo.create(db, { username: "alice", email: "alice@t.com", password_hash: "hash", role: "admin" });
    const u = userRepo.findByUsername(db, "alice");
    expect(u).toBeTruthy();
    expect(u!.email).toBe("alice@t.com");
    expect(u!.role).toBe("admin");
    expect(u!.is_active).toBe(true);
  });

  it("returns null for missing username", () => {
    const db = makeDb();
    expect(userRepo.findByUsername(db, "nobody")).toBeNull();
  });

  it("finds user by email", () => {
    const db = makeDb();
    userRepo.create(db, { username: "bob", email: "bob@t.com", password_hash: "h", role: "viewer" });
    const u = userRepo.findByEmail(db, "bob@t.com");
    expect(u?.username).toBe("bob");
  });

  it("increments failed login attempts", () => {
    const db = makeDb();
    userRepo.create(db, { username: "eve", email: "eve@t.com", password_hash: "h", role: "viewer" });
    const u = userRepo.findByUsername(db, "eve")!;
    userRepo.incrementFailedAttempts(db, u.id);
    userRepo.incrementFailedAttempts(db, u.id);
    expect(userRepo.findByUsername(db, "eve")!.failed_login_attempts).toBe(2);
  });

  it("resets failed login attempts", () => {
    const db = makeDb();
    userRepo.create(db, { username: "frank", email: "frank@t.com", password_hash: "h", role: "viewer" });
    const u = userRepo.findByUsername(db, "frank")!;
    userRepo.incrementFailedAttempts(db, u.id);
    userRepo.resetFailedAttempts(db, u.id);
    expect(userRepo.findByUsername(db, "frank")!.failed_login_attempts).toBe(0);
  });

  it("lists all users without password_hash", () => {
    const db = makeDb();
    userRepo.create(db, { username: "u1", email: "u1@t.com", password_hash: "h", role: "viewer" });
    userRepo.create(db, { username: "u2", email: "u2@t.com", password_hash: "h", role: "admin" });
    const all = userRepo.list(db);
    expect(all.length).toBe(2);
    for (const u of all) expect((u as any).password_hash).toBeUndefined();
  });

  it("updates user role", () => {
    const db = makeDb();
    userRepo.create(db, { username: "roleuser", email: "r@t.com", password_hash: "h", role: "viewer" });
    const u = userRepo.findByUsername(db, "roleuser")!;
    userRepo.updateRole(db, u.id, "sub_admin");
    expect(userRepo.findByUsername(db, "roleuser")!.role).toBe("sub_admin");
  });
});

// ── sessionRepo ───────────────────────────────────────────────────────────────

describe("sessionRepo", () => {
  function seedUser(db: DrizzleDb) {
    return userRepo.create(db, { username: "sess_user", email: "sess@t.com", password_hash: "h", role: "viewer" });
  }

  it("creates and finds session by token_hash", () => {
    const db = makeDb();
    const user = seedUser(db);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    sessionRepo.create(db, { user_id: user.id, token_hash: "tok123", expires_at: future });
    const s = sessionRepo.findByTokenHash(db, "tok123");
    expect(s).toBeTruthy();
    expect(s!.user_id).toBe(user.id);
    expect(s!.revoked_at).toBeNull();
  });

  it("returns null for unknown token", () => {
    const db = makeDb();
    expect(sessionRepo.findByTokenHash(db, "nope")).toBeNull();
  });

  it("revokes a session", () => {
    const db = makeDb();
    const user = seedUser(db);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    sessionRepo.create(db, { user_id: user.id, token_hash: "revtok", expires_at: future });
    const s = sessionRepo.findByTokenHash(db, "revtok")!;
    sessionRepo.revoke(db, s.id);
    expect(sessionRepo.findByTokenHash(db, "revtok")!.revoked_at).toBeTruthy();
  });

  it("deletes expired sessions leaving valid ones intact", () => {
    const db = makeDb();
    const user = seedUser(db);
    const past   = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    sessionRepo.create(db, { user_id: user.id, token_hash: "expired", expires_at: past });
    sessionRepo.create(db, { user_id: user.id, token_hash: "valid",   expires_at: future });
    sessionRepo.deleteExpired(db);
    expect(sessionRepo.findByTokenHash(db, "expired")).toBeNull();
    expect(sessionRepo.findByTokenHash(db, "valid")).toBeTruthy();
  });
});

// ── appRepo ───────────────────────────────────────────────────────────────────

describe("appRepo", () => {
  it("creates and finds app by base_path", () => {
    const db = makeDb();
    appRepo.create(db, { name: "Claims API", base_path: "/claims", mode: "prod", status: "active" });
    const a = appRepo.findByBasePath(db, "/claims");
    expect(a).toBeTruthy();
    expect(a!.name).toBe("Claims API");
    expect(a!.auth_required).toBe(true);
  });

  it("returns null for unknown base_path", () => {
    const db = makeDb();
    expect(appRepo.findByBasePath(db, "/nope")).toBeNull();
  });

  it("lists all apps", () => {
    const db = makeDb();
    appRepo.create(db, { name: "A1", base_path: "/a1" });
    appRepo.create(db, { name: "A2", base_path: "/a2" });
    expect(appRepo.list(db).length).toBe(2);
  });

  it("updates app status", () => {
    const db = makeDb();
    const a = appRepo.create(db, { name: "Draft", base_path: "/draft" });
    appRepo.update(db, a.id, { status: "active" });
    expect(appRepo.findById(db, a.id)?.status).toBe("active");
  });

  it("round-trips app_env JSON blob", () => {
    const db = makeDb();
    const env = [{ key: "BASE_URL", value_type: "plain", plain_value: "https://api.example.com" }];
    const a = appRepo.create(db, { name: "EnvApp", base_path: "/envapp", app_env: env });
    expect(appRepo.findById(db, a.id)?.app_env).toEqual(env);
  });

  it("deletes app", () => {
    const db = makeDb();
    const a = appRepo.create(db, { name: "Del", base_path: "/del" });
    appRepo.delete(db, a.id);
    expect(appRepo.findById(db, a.id)).toBeNull();
  });
});

// ── endpointRepo ──────────────────────────────────────────────────────────────

describe("endpointRepo", () => {
  it("creates and finds endpoints by app+method", () => {
    const db = makeDb();
    const app = appRepo.create(db, { name: "EP App", base_path: "/ep" });
    endpointRepo.create(db, { app_id: app.id, name: "Get", method: "GET", path: "/items/{id}", upstream: { url: "https://api.example.com", method: "GET" } });
    const eps = endpointRepo.findByAppAndMethod(db, app.id, "GET");
    expect(eps.length).toBe(1);
    expect(eps[0]!.path).toBe("/items/{id}");
  });

  it("deserializes upstream JSON blob on read", () => {
    const db = makeDb();
    const app = appRepo.create(db, { name: "JSONApp", base_path: "/json" });
    const upstream = { url: "https://svc.com/api", method: "POST", auth_type: "bearer", static_headers: [{ name: "X-Ver", value: "2" }] };
    endpointRepo.create(db, { app_id: app.id, name: "Create", method: "POST", path: "/items", upstream });
    const eps = endpointRepo.findByAppAndMethod(db, app.id, "POST");
    expect(eps[0]!.upstream.url).toBe("https://svc.com/api");
    expect(eps[0]!.upstream.static_headers[0].name).toBe("X-Ver");
  });

  it("round-trips deeply nested input_schema blob", () => {
    const db = makeDb();
    const app = appRepo.create(db, { name: "SchemaApp", base_path: "/schema" });
    const inputSchema = [{ id: "f1", field_path: "holder", type: "object", item_schema: [{ id: "f2", field_path: "name", type: "string" }] }];
    const ep = endpointRepo.create(db, { app_id: app.id, name: "Schema EP", method: "POST", path: "/schema", request: { input_schema: inputSchema, validation: "strict" } });
    const found = endpointRepo.findById(db, ep.id);
    expect(found!.request.input_schema[0].item_schema[0].field_path).toBe("name");
  });

  it("updateField updates only upstream without touching name", () => {
    const db = makeDb();
    const app = appRepo.create(db, { name: "UpdApp", base_path: "/upd" });
    const ep = endpointRepo.create(db, { app_id: app.id, name: "Upd", method: "GET", path: "/upd", upstream: { url: "https://old.com" } });
    endpointRepo.updateField(db, ep.id, "upstream", { url: "https://new.com", method: "GET" });
    const found = endpointRepo.findById(db, ep.id);
    expect(found?.upstream.url).toBe("https://new.com");
    expect(found?.name).toBe("Upd");
  });

  it("enforces unique app+method+path", () => {
    const db = makeDb();
    const app = appRepo.create(db, { name: "UniApp", base_path: "/uni" });
    endpointRepo.create(db, { app_id: app.id, name: "E1", method: "GET", path: "/same" });
    expect(() => {
      endpointRepo.create(db, { app_id: app.id, name: "E2", method: "GET", path: "/same" });
    }).toThrow(/UNIQUE/);
  });

  it("deletes endpoint", () => {
    const db = makeDb();
    const app = appRepo.create(db, { name: "DelEpApp", base_path: "/delep" });
    const ep = endpointRepo.create(db, { app_id: app.id, name: "DelEp", method: "DELETE", path: "/gone" });
    endpointRepo.delete(db, ep.id);
    expect(endpointRepo.findById(db, ep.id)).toBeNull();
  });
});

// ── secretRepo ────────────────────────────────────────────────────────────────

describe("secretRepo", () => {
  it("creates and finds secret by name", () => {
    const db = makeDb();
    secretRepo.create(db, { name: "DB_PASS", ciphertext: "enc", iv: "iv", auth_tag: "tag" });
    const s = secretRepo.findByName(db, "DB_PASS");
    expect(s).toBeTruthy();
    expect(s!.ciphertext).toBe("enc");
  });

  it("list omits ciphertext", () => {
    const db = makeDb();
    secretRepo.create(db, { name: "S1", ciphertext: "c1", iv: "i", auth_tag: "t" });
    secretRepo.create(db, { name: "S2", ciphertext: "c2", iv: "i", auth_tag: "t" });
    const list = secretRepo.list(db);
    expect(list.length).toBe(2);
    for (const s of list) expect((s as any).ciphertext).toBeUndefined();
  });

  it("rotates secret and updates rotated_at", () => {
    const db = makeDb();
    const s = secretRepo.create(db, { name: "ROT", ciphertext: "old", iv: "iv", auth_tag: "tag" });
    secretRepo.rotate(db, s.id, { ciphertext: "new", iv: "iv2", auth_tag: "tag2" });
    const updated = secretRepo.findById(db, s.id);
    expect(updated?.ciphertext).toBe("new");
    expect(updated?.rotated_at).toBeTruthy();
  });
});
