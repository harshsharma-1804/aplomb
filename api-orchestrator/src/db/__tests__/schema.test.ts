import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { organization, users, sessions, secrets, host_allowlist, apps, endpoints, app_scripts, version_history } from "../schema.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

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
    deprecated_at TEXT, auth_required INTEGER NOT NULL DEFAULT 1, ai_expose INTEGER NOT NULL DEFAULT 0,
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
    script_mode TEXT NOT NULL DEFAULT 'none', script_file_id TEXT, folder TEXT,
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
    folder TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(app_id, filename)
  );
  CREATE TABLE IF NOT EXISTS version_history (
    id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id),
    change_type TEXT NOT NULL, changed_by TEXT NOT NULL DEFAULT '{}',
    description TEXT DEFAULT '', snapshot TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
`;

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  sqlite.exec(DDL);
  return { db, sqlite };
}

const now = new Date().toISOString();

describe("schema — table creation and constraints", () => {
  it("inserts and reads an organization row", () => {
    const { db } = makeDb();
    const id = randomUUID();
    db.insert(organization).values({ id, name: "Acme", slug: "acme", created_at: now, updated_at: now }).run();
    const row = db.select().from(organization).where(eq(organization.id, id)).get();
    expect(row?.name).toBe("Acme");
    expect(row?.slug).toBe("acme");
  });

  it("enforces unique slug on organization", () => {
    const { db } = makeDb();
    db.insert(organization).values({ id: randomUUID(), name: "A", slug: "dup", created_at: now, updated_at: now }).run();
    expect(() => {
      db.insert(organization).values({ id: randomUUID(), name: "B", slug: "dup", created_at: now, updated_at: now }).run();
    }).toThrow(/UNIQUE/);
  });

  it("inserts and reads a user with correct defaults", () => {
    const { db } = makeDb();
    const id = randomUUID();
    db.insert(users).values({ id, username: "alice", email: "alice@test.com", password_hash: "hash", role: "admin", created_at: now, updated_at: now }).run();
    const row = db.select().from(users).where(eq(users.id, id)).get();
    expect(row?.username).toBe("alice");
    expect(row?.role).toBe("admin");
    expect(row?.is_active).toBe(true);
    expect(row?.failed_login_attempts).toBe(0);
  });

  it("enforces unique username", () => {
    const { db } = makeDb();
    db.insert(users).values({ id: randomUUID(), username: "bob", email: "bob@test.com", password_hash: "h", created_at: now, updated_at: now }).run();
    expect(() => {
      db.insert(users).values({ id: randomUUID(), username: "bob", email: "bob2@test.com", password_hash: "h", created_at: now, updated_at: now }).run();
    }).toThrow(/UNIQUE/);
  });

  it("enforces unique email", () => {
    const { db } = makeDb();
    db.insert(users).values({ id: randomUUID(), username: "u1", email: "same@test.com", password_hash: "h", created_at: now, updated_at: now }).run();
    expect(() => {
      db.insert(users).values({ id: randomUUID(), username: "u2", email: "same@test.com", password_hash: "h", created_at: now, updated_at: now }).run();
    }).toThrow(/UNIQUE/);
  });

  it("inserts session referencing user", () => {
    const { db } = makeDb();
    const uid = randomUUID();
    db.insert(users).values({ id: uid, username: "u", email: "u@t.com", password_hash: "h", created_at: now, updated_at: now }).run();
    const sid = randomUUID();
    db.insert(sessions).values({ id: sid, user_id: uid, token_hash: "tok", expires_at: now, created_at: now }).run();
    const row = db.select().from(sessions).where(eq(sessions.id, sid)).get();
    expect(row?.token_hash).toBe("tok");
  });

  it("stores and retrieves deeply nested JSON blob on endpoint", () => {
    const { db } = makeDb();
    const appId = randomUUID();
    db.insert(apps).values({ id: appId, name: "MyApp", base_path: "/api/v1", created_at: now, updated_at: now }).run();

    const inputSchema = [{ id: "f1", field_path: "holder", type: "object", nullable: false, description: "", sort_order: 0, item_schema: [{ id: "f2", field_path: "name", type: "string", nullable: false, description: "", sort_order: 0 }] }];
    const upstream = { url: "https://api.example.com", method: "GET", auth_type: "none", static_headers: [], forwarded_headers: [], body_mappings: [] };

    const epId = randomUUID();
    db.insert(endpoints).values({
      id: epId, app_id: appId, name: "Get Claim", method: "GET", path: "/claims/{id}",
      request: JSON.stringify({ content_type: "application/json", validation: "strict", input_schema: inputSchema }),
      upstream: JSON.stringify(upstream),
      output_schema: JSON.stringify(inputSchema),
      created_at: now, updated_at: now,
    }).run();

    const row = db.select().from(endpoints).where(eq(endpoints.id, epId)).get();
    expect(row).toBeTruthy();
    const parsedRequest = JSON.parse(row!.request);
    expect(parsedRequest.input_schema[0].field_path).toBe("holder");
    expect(parsedRequest.input_schema[0].item_schema[0].field_path).toBe("name");
    const parsedUpstream = JSON.parse(row!.upstream);
    expect(parsedUpstream.url).toBe("https://api.example.com");
  });

  it("enforces unique (app_id, method, path) on endpoints", () => {
    const { db } = makeDb();
    const appId = randomUUID();
    db.insert(apps).values({ id: appId, name: "App", base_path: "/dup", created_at: now, updated_at: now }).run();
    db.insert(endpoints).values({ id: randomUUID(), app_id: appId, name: "E1", method: "GET", path: "/foo", created_at: now, updated_at: now }).run();
    expect(() => {
      db.insert(endpoints).values({ id: randomUUID(), app_id: appId, name: "E2", method: "GET", path: "/foo", created_at: now, updated_at: now }).run();
    }).toThrow(/UNIQUE/);
  });

  it("allows same path on different methods", () => {
    const { db } = makeDb();
    const appId = randomUUID();
    db.insert(apps).values({ id: appId, name: "App2", base_path: "/multi", created_at: now, updated_at: now }).run();
    db.insert(endpoints).values({ id: randomUUID(), app_id: appId, name: "G", method: "GET",  path: "/res", created_at: now, updated_at: now }).run();
    db.insert(endpoints).values({ id: randomUUID(), app_id: appId, name: "P", method: "POST", path: "/res", created_at: now, updated_at: now }).run();
    const rows = db.select().from(endpoints).where(eq(endpoints.app_id, appId)).all();
    expect(rows.length).toBe(2);
  });

  it("enforces unique (app_id, filename) on app_scripts", () => {
    const { db } = makeDb();
    const appId = randomUUID();
    db.insert(apps).values({ id: appId, name: "ScriptApp", base_path: "/scripts", created_at: now, updated_at: now }).run();
    db.insert(app_scripts).values({ id: randomUUID(), app_id: appId, filename: "handler.js", created_at: now, updated_at: now }).run();
    expect(() => {
      db.insert(app_scripts).values({ id: randomUUID(), app_id: appId, filename: "handler.js", created_at: now, updated_at: now }).run();
    }).toThrow(/UNIQUE/);
  });

  it("stores and retrieves version_history snapshot blob", () => {
    const { db } = makeDb();
    const appId = randomUUID();
    db.insert(apps).values({ id: appId, name: "VApp", base_path: "/vapp", created_at: now, updated_at: now }).run();
    const snapshot = { app: { name: "VApp" }, endpoints: [{ path: "/foo" }] };
    const vid = randomUUID();
    db.insert(version_history).values({
      id: vid, app_id: appId, change_type: "endpoint_added",
      changed_by: JSON.stringify({ user_id: null, username: "admin" }),
      snapshot: JSON.stringify(snapshot), created_at: now,
    }).run();
    const row = db.select().from(version_history).where(eq(version_history.id, vid)).get();
    const parsed = JSON.parse(row!.snapshot);
    expect(parsed.endpoints[0].path).toBe("/foo");
  });

  it("enforces unique hostname on host_allowlist", () => {
    const { db } = makeDb();
    db.insert(host_allowlist).values({ id: randomUUID(), hostname: "api.example.com", created_at: now }).run();
    expect(() => {
      db.insert(host_allowlist).values({ id: randomUUID(), hostname: "api.example.com", created_at: now }).run();
    }).toThrow(/UNIQUE/);
  });

  it("inserts secret and reads back encrypted fields", () => {
    const { db } = makeDb();
    const id = randomUUID();
    db.insert(secrets).values({ id, name: "MY_API_KEY", ciphertext: "enc", iv: "iv123", auth_tag: "tag", created_at: now }).run();
    const row = db.select().from(secrets).where(eq(secrets.id, id)).get();
    expect(row?.ciphertext).toBe("enc");
    expect(row?.iv).toBe("iv123");
  });
});
