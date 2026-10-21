/**
 * DB upstream executor — supports MongoDB, PostgreSQL, MySQL.
 *
 * Connection pools are keyed by SHA-256 hash of the fully resolved DB URL
 * (credentials stripped from logs/memory after pool init). Pools are created
 * lazily on first request and reused across subsequent requests.
 *
 * Shutdown: call closeAllPools() on SIGTERM/SIGINT.
 */

import { createHash } from "crypto";
import { config } from "../config/appConfig.js";
import { appDbConnectionRepo } from "../db/repos/appDbConnectionRepo.js";
import { resolveSecret } from "../secrets/resolver.js";
import { getDb } from "../db/client.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DbUpstreamType = "mongodb" | "postgresql" | "mysql";

/**
 * Driver-level connection options.
 * For named connections these are stored in app_db_connections.options JSON.
 * For raw db_url endpoints they are set directly on the endpoint upstream config.
 */
export interface DbConnOptions {
  /** Require TLS — needed for Supabase, RDS, Atlas, PlanetScale, etc. */
  ssl?:        boolean;
  /**
   * Force IPv4 DNS resolution (family:4).
   * Prevents ENETUNREACH when the Docker host has no IPv6 internet route
   * and the DB hostname resolves to an AAAA record first.
   */
  force_ipv4?: boolean;
}

export interface DbEndpointConfig {
  upstream_type:      DbUpstreamType;
  /** Named connection ID (from app_db_connections). When set, db_url is ignored. */
  db_connection_id?:  string;
  db_url:             string; // pre-resolved connection URL (used when no db_connection_id)
  /** Options for raw db_url endpoints (named connections store these in their options JSON) */
  db_ssl?:            boolean;
  db_force_ipv4?:     boolean;
  db_collection?:     string; // MongoDB only
  db_operation?:      string; // MongoDB only
  db_result_limit?:   number; // MongoDB find/aggregate only, default 100
  db_query_template?: string;
  db_query_mode?:     "rows" | "row"; // PostgreSQL only, default "rows"
}

/**
 * Builds a connection URL from a named AppDbConnection row.
 * Schema:
 *   mongodb:    mongodb://[user:pass@]host/database
 *   postgresql: postgresql://[user:pass@]host/database
 *   mysql:      mysql://[user:pass@]host/database
 */
export function buildConnectionUrl(
  dbType: DbUpstreamType,
  host: string,
  database: string,
  username?: string | null,
  secretId?: string | null,
): string {
  const password = secretId ? resolveSecret(secretId) : null;
  const auth = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@`
    : password
    ? `:${encodeURIComponent(password)}@`
    : "";
  const scheme =
    dbType === "mongodb"    ? "mongodb" :
    dbType === "postgresql" ? "postgresql" :
    "mysql";
  return `${scheme}://${auth}${host}/${database}`;
}

/**
 * Resolves the effective DB URL for a request — either from a named connection
 * (db_connection_id) or from the already-resolved db_url on the endpoint config.
 */
export function resolveDbUrl(cfg: DbEndpointConfig, appId: string): { url: string; opts: DbConnOptions } {
  if (cfg.db_connection_id) {
    const conn = appDbConnectionRepo.findByIdAndApp(getDb(), cfg.db_connection_id, appId);
    if (!conn) {
      throw Object.assign(
        new Error(`DB connection "${cfg.db_connection_id}" not found for this app`),
        { code: "DB_CONNECTION_ERROR" }
      );
    }
    // opts come from the named connection's stored options JSON (already deserialized by repo)
    const opts: DbConnOptions = (conn.options ?? {}) as DbConnOptions;
    return {
      url:  buildConnectionUrl(conn.db_type as DbUpstreamType, conn.host, conn.database, conn.username, conn.secret_id),
      opts,
    };
  }
  if (!cfg.db_url) {
    throw Object.assign(new Error("No DB connection configured on this endpoint"), { code: "DB_CONNECTION_ERROR" });
  }
  // For raw db_url endpoints, opts come from endpoint-level flags
  return {
    url:  cfg.db_url,
    opts: { ssl: Boolean(cfg.db_ssl), force_ipv4: Boolean(cfg.db_force_ipv4) },
  };
}

export interface DbUpstreamResult {
  data: unknown;
  /** Human-readable description of what was sent to the DB — for the Test tab */
  upstreamRequest: {
    db_type:           DbUpstreamType;
    db_url_masked:     string; // host:port/dbname only, credentials stripped
    operation?:        string; // MongoDB
    collection?:       string; // MongoDB
    resolved_query:    string;
  };
}

// ── Allowed MongoDB operations ────────────────────────────────────────────────

const ALLOWED_MONGO_OPS = new Set([
  "find", "findOne", "insertOne", "updateOne", "updateMany",
  "deleteOne", "deleteMany", "aggregate", "count",
]);

// ── Mask credentials from a DB URL for logging / UI ──────────────────────────

function maskDbUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

// ── Pool registry ─────────────────────────────────────────────────────────────

const mongoClients = new Map<string, import("mongodb").MongoClient>();
const pgPools      = new Map<string, import("pg").Pool>();
const mysqlPools   = new Map<string, import("mysql2/promise").Pool>();

function urlKey(resolvedUrl: string, opts?: DbConnOptions): string {
  const suffix = `ssl=${Boolean(opts?.ssl)}:ipv4=${Boolean(opts?.force_ipv4)}`;
  return createHash("sha256").update(resolvedUrl + "|" + suffix).digest("hex");
}

// ── MongoDB pool ──────────────────────────────────────────────────────────────

async function getMongoClient(resolvedUrl: string, opts?: DbConnOptions): Promise<import("mongodb").MongoClient> {
  const key = urlKey(resolvedUrl, opts);
  if (mongoClients.has(key)) return mongoClients.get(key)!;

  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(resolvedUrl, {
    maxPoolSize:              config.db.maxPoolSize,
    connectTimeoutMS:         config.db.connectTimeoutMs,
    serverSelectionTimeoutMS: config.db.connectTimeoutMs,
    socketTimeoutMS:          config.db.queryTimeoutMs,
    ...(opts?.force_ipv4 ? { family: 4 } : {}),
    ...(opts?.ssl        ? { tls: true } : {}),
  });
  await client.connect();
  mongoClients.set(key, client);
  return client;
}

// ── PostgreSQL pool ───────────────────────────────────────────────────────────

async function getPgPool(resolvedUrl: string, opts?: DbConnOptions): Promise<import("pg").Pool> {
  const key = urlKey(resolvedUrl, opts);
  if (pgPools.has(key)) return pgPools.get(key)!;

  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString:                    resolvedUrl,
    max:                                 config.db.maxPoolSize,
    connectionTimeoutMillis:             config.db.connectTimeoutMs,
    statement_timeout:                   config.db.queryTimeoutMs,
    idle_in_transaction_session_timeout: config.db.queryTimeoutMs,
    // force_ipv4: prevents picking AAAA records when Docker has no IPv6 route
    ...(opts?.force_ipv4 ? { family: 4 } : {}),
    // ssl: accepts managed-DB cert chains (same behaviour as Supabase JS client)
    ...(opts?.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  pgPools.set(key, pool);
  return pool;
}

// ── MySQL pool ────────────────────────────────────────────────────────────────

async function getMysqlPool(resolvedUrl: string, opts?: DbConnOptions): Promise<import("mysql2/promise").Pool> {
  const key = urlKey(resolvedUrl, opts);
  if (mysqlPools.has(key)) return mysqlPools.get(key)!;

  const mysql2 = await import("mysql2/promise");
  const pool = mysql2.createPool({
    uri:             resolvedUrl,
    connectionLimit: config.db.maxPoolSize,
    connectTimeout:  config.db.connectTimeoutMs,
    ...(opts?.force_ipv4 ? { family: 4 } : {}),
    ...(opts?.ssl        ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  mysqlPools.set(key, pool);
  return pool;
}

// ── Query template resolution ─────────────────────────────────────────────────

/**
 * Resolves `{paramName}` placeholders from path/query params.
 * `{{ENV_VAR}}` should already be resolved in the URL — this resolves them
 * in the template too (they come in pre-resolved via the app env pipeline in router.ts).
 *
 * For SQL (pg/mysql): returns resolved SQL string + ordered values array for
 * parameterized binding. Each unique `{paramName}` is assigned a bind position.
 *
 * Returns: { resolved: string, values: string[] }
 *   - For MongoDB: values is always [] (params are substituted inline before JSON.parse)
 *   - For SQL: values carries the bind array; `{param}` replaced with $1/$2/? in resolved
 */
export function resolveQueryTemplate(
  template: string,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
  dbType: DbUpstreamType
): { resolved: string; values: string[] } {
  if (!template) return { resolved: "", values: [] };

  const allParams: Record<string, string> = { ...queryParams, ...pathParams }; // path takes precedence

  if (dbType === "mongodb") {
    // For MongoDB: substitute inline (result is JSON-parsed, so no injection risk
    // since the driver sees an object, not a string command).
    let resolved = template;
    const missingPlaceholders: string[] = [];
    resolved = resolved.replace(/\{([^{}]+)\}/g, (match, name) => {
      if (name in allParams) return allParams[name]!;
      missingPlaceholders.push(name);
      return match;
    });
    if (missingPlaceholders.length > 0) {
      throw Object.assign(
        new Error(`Query template references unknown placeholders: ${missingPlaceholders.map(p => `{${p}}`).join(", ")}`),
        { code: "DB_TEMPLATE_PARAM_MISSING" }
      );
    }
    return { resolved, values: [] };
  }

  // For SQL (postgresql / mysql): collect placeholders in order of appearance,
  // replace each unique name with the appropriate bind marker.
  const paramOrder: string[] = [];
  const seenParams = new Map<string, number>(); // name → 1-based index (pg only)

  const resolved = template.replace(/\{([^{}]+)\}/g, (match, name) => {
    if (!(name in allParams)) {
      throw Object.assign(
        new Error(`Query template references unknown placeholder: {${name}}`),
        { code: "DB_TEMPLATE_PARAM_MISSING" }
      );
    }
    if (dbType === "postgresql") {
      if (!seenParams.has(name)) {
        seenParams.set(name, seenParams.size + 1);
        paramOrder.push(name);
      }
      return `$${seenParams.get(name)}`;
    } else {
      // mysql: each occurrence is a separate ? in order
      paramOrder.push(name);
      return "?";
    }
  });

  const values = paramOrder.map(n => allParams[n] ?? "");
  return { resolved, values };
}

// ── MongoDB executor ──────────────────────────────────────────────────────────

function mongoSafeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "object") {
    // ObjectId — has toString
    if ((v as any)._bsontype === "ObjectId" || typeof (v as any).toHexString === "function") {
      return String(v);
    }
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(mongoSafeValue);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object)) out[k] = mongoSafeValue(val);
    return out;
  }
  return v;
}

async function executeMongo(
  resolvedUrl: string,
  cfg: DbEndpointConfig,
  resolvedTemplate: string,
  opts?: DbConnOptions
): Promise<unknown> {
  const operation = (cfg.db_operation ?? "find").toLowerCase();
  if (!ALLOWED_MONGO_OPS.has(operation)) {
    throw Object.assign(
      new Error(`MongoDB operation "${operation}" is not allowed. Allowed: ${[...ALLOWED_MONGO_OPS].join(", ")}`),
      { code: "DB_OPERATION_NOT_ALLOWED" }
    );
  }

  let client: import("mongodb").MongoClient;
  try {
    client = await getMongoClient(resolvedUrl, opts);
  } catch (e: any) {
    throw Object.assign(new Error(`MongoDB connection failed: ${e.message}`), { code: "DB_CONNECTION_ERROR" });
  }

  // Parse URL to extract database name from path
  let dbName: string;
  try {
    dbName = new URL(resolvedUrl).pathname.replace(/^\//, "") || "test";
  } catch {
    dbName = "test";
  }

  const db = client.db(dbName);
  const collection = db.collection(cfg.db_collection ?? "");

  // Parse the resolved template as JSON (or get from empty string → empty object)
  let queryObj: unknown = {};
  if (resolvedTemplate.trim()) {
    try {
      queryObj = JSON.parse(resolvedTemplate);
    } catch (e: any) {
      throw Object.assign(
        new Error(`Query template is not valid JSON: ${e.message}`),
        { code: "DB_TEMPLATE_PARSE_ERROR" }
      );
    }
  }

  const limit = cfg.db_result_limit ?? 100;

  try {
    let result: unknown;
    switch (operation) {
      case "find":
        result = await collection.find(queryObj as object).limit(limit).toArray();
        break;
      case "findOne":
        result = await collection.findOne(queryObj as object);
        break;
      case "insertOne":
        result = await collection.insertOne(queryObj as object);
        break;
      case "updateOne": {
        const { filter, update } = queryObj as { filter: object; update: object };
        result = await collection.updateOne(filter, update);
        break;
      }
      case "updateMany": {
        const { filter, update } = queryObj as { filter: object; update: object };
        result = await collection.updateMany(filter, update);
        break;
      }
      case "deleteOne":
        result = await collection.deleteOne(queryObj as object);
        break;
      case "deleteMany":
        result = await collection.deleteMany(queryObj as object);
        break;
      case "aggregate":
        result = await collection.aggregate(queryObj as object[]).limit(limit).toArray();
        break;
      case "count":
        result = await collection.countDocuments(queryObj as object);
        break;
      default:
        throw Object.assign(new Error(`Unknown operation: ${operation}`), { code: "DB_OPERATION_NOT_ALLOWED" });
    }
    return mongoSafeValue(result);
  } catch (e: any) {
    if (e.code === "DB_OPERATION_NOT_ALLOWED" || e.code === "DB_TEMPLATE_PARSE_ERROR") throw e;
    throw Object.assign(new Error(`MongoDB query error: ${e.message}`), { code: "DB_QUERY_ERROR" });
  }
}

// ── PostgreSQL executor ───────────────────────────────────────────────────────

async function executePg(
  resolvedUrl: string,
  cfg: DbEndpointConfig,
  sql: string,
  values: string[],
  opts?: DbConnOptions
): Promise<unknown> {
  let pool: import("pg").Pool;
  try {
    pool = await getPgPool(resolvedUrl, opts);
  } catch (e: any) {
    throw Object.assign(new Error(`PostgreSQL connection failed: ${e.message}`), { code: "DB_CONNECTION_ERROR" });
  }

  try {
    const result = await pool.query(sql, values);
    if (cfg.db_query_mode === "row") return result.rows[0] ?? null;
    return result.rows;
  } catch (e: any) {
    if (e.message?.includes("connect") || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT") {
      throw Object.assign(new Error(`PostgreSQL connection error: ${e.message}`), { code: "DB_CONNECTION_ERROR" });
    }
    throw Object.assign(new Error(`PostgreSQL query error: ${e.message}`), { code: "DB_QUERY_ERROR" });
  }
}

// ── MySQL executor ────────────────────────────────────────────────────────────

async function executeMysql(
  resolvedUrl: string,
  _cfg: DbEndpointConfig,
  sql: string,
  values: string[],
  opts?: DbConnOptions
): Promise<unknown> {
  let pool: import("mysql2/promise").Pool;
  try {
    pool = await getMysqlPool(resolvedUrl, opts);
  } catch (e: any) {
    throw Object.assign(new Error(`MySQL connection failed: ${e.message}`), { code: "DB_CONNECTION_ERROR" });
  }

  try {
    const [rows] = await pool.execute(sql, values);
    // For SELECT: rows is an array of RowDataPacket objects
    // For INSERT/UPDATE/DELETE: rows is an OkPacket with affectedRows, insertId
    if (Array.isArray(rows)) return rows;
    const r = rows as any;
    return { affectedRows: r.affectedRows ?? 0, insertId: r.insertId ?? null };
  } catch (e: any) {
    if (e.message?.includes("connect") || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT" || e.code === "ER_ACCESS_DENIED_ERROR") {
      throw Object.assign(new Error(`MySQL connection error: ${e.message}`), { code: "DB_CONNECTION_ERROR" });
    }
    throw Object.assign(new Error(`MySQL query error: ${e.message}`), { code: "DB_QUERY_ERROR" });
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function callDbUpstream(
  cfg: DbEndpointConfig,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
  appId: string,
): Promise<DbUpstreamResult> {
  const { url: resolvedUrl, opts } = resolveDbUrl(cfg, appId);
  const dbType = cfg.upstream_type;
  const template = cfg.db_query_template ?? "";

  // Validate MongoDB operation at runtime (also validated at save time)
  if (dbType === "mongodb") {
    const op = (cfg.db_operation ?? "find").toLowerCase();
    if (!ALLOWED_MONGO_OPS.has(op)) {
      throw Object.assign(
        new Error(`MongoDB operation "${op}" is not allowed`),
        { code: "DB_OPERATION_NOT_ALLOWED" }
      );
    }
    // Block $where entirely
    if (template.includes("$where")) {
      throw Object.assign(
        new Error(`$where is not allowed in query templates`),
        { code: "DB_OPERATION_NOT_ALLOWED" }
      );
    }
  }

  const { resolved, values } = resolveQueryTemplate(template, pathParams, queryParams, dbType);

  const upstreamRequest = {
    db_type:        dbType,
    db_url_masked:  maskDbUrl(resolvedUrl),
    operation:      cfg.db_operation,
    collection:     cfg.db_collection,
    resolved_query: resolved || "(empty — all documents)",
  };

  let data: unknown;

  if (dbType === "mongodb") {
    data = await executeMongo(resolvedUrl, cfg, resolved, opts);
  } else if (dbType === "postgresql") {
    if (!resolved.trim()) throw Object.assign(new Error("SQL query template is empty"), { code: "DB_TEMPLATE_PARSE_ERROR" });
    data = await executePg(resolvedUrl, cfg, resolved, values, opts);
  } else if (dbType === "mysql") {
    if (!resolved.trim()) throw Object.assign(new Error("SQL query template is empty"), { code: "DB_TEMPLATE_PARSE_ERROR" });
    data = await executeMysql(resolvedUrl, cfg, resolved, values, opts);
  } else {
    throw Object.assign(new Error(`Unsupported upstream_type: ${dbType}`), { code: "DB_CONNECTION_ERROR" });
  }

  // Validate result is serializable
  try {
    JSON.stringify(data);
  } catch {
    throw Object.assign(new Error("DB result contains non-serializable values"), { code: "DB_RESULT_PARSE_ERROR" });
  }

  return { data, upstreamRequest };
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export async function closeAllPools(): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const client of mongoClients.values()) tasks.push(client.close().catch(() => {}));
  for (const pool of pgPools.values())        tasks.push(pool.end().catch(() => {}));
  for (const pool of mysqlPools.values())     tasks.push(pool.end().catch(() => {}));
  await Promise.allSettled(tasks);
  mongoClients.clear();
  pgPools.clear();
  mysqlPools.clear();
}
