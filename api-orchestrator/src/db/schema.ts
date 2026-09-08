import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ── organizations ─────────────────────────────────────────────────────────────
// Single row — the tenant identity for this instance (SaaS VM or self-hosted).
// No org_id discriminator needed anywhere else — the DB IS the org.
export const organization = sqliteTable("organization", {
  id:         text("id").primaryKey(),
  name:       text("name").notNull(),
  slug:       text("slug").notNull().unique(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── users ─────────────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id:                    text("id").primaryKey(),
  username:              text("username").notNull().unique(),
  email:                 text("email").notNull().unique(),
  password_hash:         text("password_hash").notNull(),
  role:                  text("role").notNull().default("viewer"),
  is_active:             integer("is_active", { mode: "boolean" }).notNull().default(true),
  must_change_password:  integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  failed_login_attempts: integer("failed_login_attempts").notNull().default(0),
  locked_until:          text("locked_until"),
  last_login_at:         text("last_login_at"),
  created_by:            text("created_by"),
  created_at:            text("created_at").notNull(),
  updated_at:            text("updated_at").notNull(),
});

// ── sessions ──────────────────────────────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  id:         text("id").primaryKey(),
  user_id:    text("user_id").notNull().references(() => users.id),
  token_hash: text("token_hash").notNull(),
  expires_at: text("expires_at").notNull(),
  ip:         text("ip").default(""),
  user_agent: text("user_agent").default(""),
  revoked_at: text("revoked_at"),
  created_at: text("created_at").notNull(),
}, (t) => [
  index("idx_sessions_token_hash").on(t.token_hash),
  index("idx_sessions_user_id").on(t.user_id),
  index("idx_sessions_expires_at").on(t.expires_at),
]);

// ── secrets ───────────────────────────────────────────────────────────────────
export const secrets = sqliteTable("secrets", {
  id:           text("id").primaryKey(),
  name:         text("name").notNull().unique(),
  description:  text("description").default(""),
  ciphertext:   text("ciphertext").notNull(),
  iv:           text("iv").notNull(),
  auth_tag:     text("auth_tag").notNull(),
  created_by:   text("created_by"),
  rotated_at:   text("rotated_at"),
  last_used_at: text("last_used_at"),
  created_at:   text("created_at").notNull(),
});

// ── identity_providers ────────────────────────────────────────────────────────
export const identity_providers = sqliteTable("identity_providers", {
  id:                  text("id").primaryKey(),
  name:                text("name").notNull(),
  type:                text("type").notNull().default("oidc"),
  issuer:              text("issuer").notNull().unique(),
  jwks_uri:            text("jwks_uri"),
  audience:            text("audience").notNull().default("[]"),
  algorithms:          text("algorithms").notNull().default('["RS256"]'),
  claim_mappings:      text("claim_mappings").notNull().default('{"subject":"sub","email":"email","roles":"groups"}'),
  clock_tolerance_sec: integer("clock_tolerance_sec").notNull().default(60),
  is_active:           integer("is_active", { mode: "boolean" }).notNull().default(true),
  created_by:          text("created_by"),
  created_at:          text("created_at").notNull(),
  updated_at:          text("updated_at").notNull(),
});

// ── host_allowlist ────────────────────────────────────────────────────────────
export const host_allowlist = sqliteTable("host_allowlist", {
  id:          text("id").primaryKey(),
  hostname:    text("hostname").notNull().unique(),
  description: text("description").default(""),
  is_wildcard: integer("is_wildcard", { mode: "boolean" }).notNull().default(false),
  created_by:  text("created_by"),
  created_at:  text("created_at").notNull(),
});

// ── apps ──────────────────────────────────────────────────────────────────────
export const apps = sqliteTable("apps", {
  id:                   text("id").primaryKey(),
  name:                 text("name").notNull(),
  base_path:            text("base_path").notNull().unique(),
  description:          text("description").default(""),
  status:               text("status").notNull().default("draft"),
  deprecated_at:        text("deprecated_at"),
  auth_required:        integer("auth_required", { mode: "boolean" }).notNull().default(true),
  ai_expose:            integer("ai_expose", { mode: "boolean" }).notNull().default(false),
  mode:                 text("mode").notNull().default("prod"),
  // JSON blobs — freely evolving, no migration when new fields added
  app_env:              text("app_env").notNull().default("[]"),
  allowed_provider_ids: text("allowed_provider_ids").notNull().default("[]"),
  created_by:           text("created_by"),
  created_at:           text("created_at").notNull(),
  updated_at:           text("updated_at").notNull(),
});

// ── endpoints ─────────────────────────────────────────────────────────────────
export const endpoints = sqliteTable("endpoints", {
  id:             text("id").primaryKey(),
  app_id:         text("app_id").notNull().references(() => apps.id),
  name:           text("name").notNull(),
  description:    text("description").default(""),
  method:         text("method").notNull(),
  path:           text("path").notNull(),
  is_active:      integer("is_active", { mode: "boolean" }).notNull().default(true),
  script_mode:    text("script_mode").notNull().default("none"),
  script_file_id: text("script_file_id"),
  folder:         text("folder"),

  // JSON blobs — request/response schema can grow arbitrarily deep
  path_params:     text("path_params").notNull().default("[]"),
  query_params:    text("query_params").notNull().default("[]"),
  request:         text("request").notNull().default("{}"),
  upstream:        text("upstream").notNull().default("{}"),
  output_schema:   text("output_schema").notNull().default("[]"),
  field_mappings:  text("field_mappings").notNull().default("[]"),
  sample_response: text("sample_response"),

  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
}, (t) => [
  index("idx_endpoints_app_id").on(t.app_id),
  index("idx_endpoints_app_method").on(t.app_id, t.method),
  uniqueIndex("idx_endpoints_unique").on(t.app_id, t.method, t.path),
]);

// ── app_scripts ───────────────────────────────────────────────────────────────
export const app_scripts = sqliteTable("app_scripts", {
  id:          text("id").primaryKey(),
  app_id:      text("app_id").notNull().references(() => apps.id),
  filename:    text("filename").notNull(),
  language:    text("language").notNull().default("javascript"),
  source:      text("source").notNull().default(""),
  compiled:    text("compiled"),
  description: text("description").default(""),
  folder:      text("folder"),
  created_at:  text("created_at").notNull(),
  updated_at:  text("updated_at").notNull(),
}, (t) => [
  uniqueIndex("idx_app_scripts_unique").on(t.app_id, t.filename),
]);

// ── cors_origins ──────────────────────────────────────────────────────────────
// Operator-configured origins allowed to call runtime API endpoints from browsers.
export const cors_origins = sqliteTable("cors_origins", {
  id:          text("id").primaryKey(),
  origin:      text("origin").notNull().unique(),
  description: text("description").default(""),
  created_by:  text("created_by"),
  created_at:  text("created_at").notNull(),
});

// ── ai_providers ──────────────────────────────────────────────────────────────
// LLM providers configured by the admin in the dashboard (OpenAI-compatible).
// api_key is encrypted at rest with the same crypto as secrets.
export const ai_providers = sqliteTable("ai_providers", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  base_url:    text("base_url").notNull(),
  model:       text("model").notNull(),
  // Key source — vault reference takes precedence when set; otherwise embedded
  // encrypted key material (ciphertext/iv/auth_tag) is used.
  secret_id:   text("secret_id"),
  ciphertext:  text("ciphertext").notNull().default(""),
  iv:          text("iv").notNull().default(""),
  auth_tag:    text("auth_tag").notNull().default(""),
  is_active:   integer("is_active", { mode: "boolean" }).notNull().default(true),
  created_by:  text("created_by"),
  created_at:  text("created_at").notNull(),
  updated_at:  text("updated_at").notNull(),
});

// ── ai_bots ───────────────────────────────────────────────────────────────────
// Registered chatbot clients. api_key is generated once (shown to admin),
// stored as an argon2 hash. Bots call /__ai/chat and /mcp with X-Bot-Key.
export const ai_bots = sqliteTable("ai_bots", {
  id:            text("id").primaryKey(),
  name:          text("name").notNull(),
  api_key_hash:  text("api_key_hash").notNull(),
  is_active:     integer("is_active", { mode: "boolean" }).notNull().default(true),
  // Deny-by-default bindings — empty = no access until admin assigns
  allowed_app_ids:      text("allowed_app_ids").notNull().default("[]"),
  allowed_provider_ids: text("allowed_provider_ids").notNull().default("[]"),
  last_used_at:  text("last_used_at"),
  created_by:    text("created_by"),
  created_at:    text("created_at").notNull(),
});

// ── ai_tool_calls ─────────────────────────────────────────────────────────────
// Audit trail for every AI-initiated tool call, incl. scope violations.
export const ai_tool_calls = sqliteTable("ai_tool_calls", {
  id:          text("id").primaryKey(),
  bot_id:      text("bot_id"),
  bot_name:    text("bot_name").default(""),
  user_id:     text("user_id").default(""),
  tool_name:   text("tool_name").notNull(),
  tool_args:   text("tool_args").notNull().default("{}"),
  outcome:     text("outcome").notNull(),   // ok | tool_error | scope_violation | denied
  detail:      text("detail").default(""),
  latency_ms:  integer("latency_ms").default(0),
  created_at:  text("created_at").notNull(),
}, (t) => [
  index("idx_ai_tool_calls_created").on(t.created_at),
]);

// ── version_history ───────────────────────────────────────────────────────────
export const version_history = sqliteTable("version_history", {
  id:          text("id").primaryKey(),
  app_id:      text("app_id").notNull().references(() => apps.id),
  change_type: text("change_type").notNull(),
  changed_by:  text("changed_by").notNull().default("{}"),
  description: text("description").default(""),
  snapshot:    text("snapshot").notNull().default("{}"),
  created_at:  text("created_at").notNull(),
}, (t) => [
  index("idx_version_history_app").on(t.app_id, t.created_at),
]);

// ── Type exports ──────────────────────────────────────────────────────────────
export type Organization     = typeof organization.$inferSelect;
export type NewOrganization  = typeof organization.$inferInsert;
export type User             = typeof users.$inferSelect;
export type NewUser          = typeof users.$inferInsert;
export type Session          = typeof sessions.$inferSelect;
export type NewSession       = typeof sessions.$inferInsert;
export type Secret           = typeof secrets.$inferSelect;
export type NewSecret        = typeof secrets.$inferInsert;
export type IdentityProvider    = typeof identity_providers.$inferSelect;
export type NewIdentityProvider = typeof identity_providers.$inferInsert;
export type HostAllowlist    = typeof host_allowlist.$inferSelect;
export type NewHostAllowlist = typeof host_allowlist.$inferInsert;
export type App              = typeof apps.$inferSelect;
export type NewApp           = typeof apps.$inferInsert;
export type Endpoint         = typeof endpoints.$inferSelect;
export type NewEndpoint      = typeof endpoints.$inferInsert;
export type AppScript        = typeof app_scripts.$inferSelect;
export type NewAppScript     = typeof app_scripts.$inferInsert;
export type VersionHistory   = typeof version_history.$inferSelect;
export type NewVersionHistory = typeof version_history.$inferInsert;
export type CorsOrigin       = typeof cors_origins.$inferSelect;
export type NewCorsOrigin    = typeof cors_origins.$inferInsert;
export type AiProvider       = typeof ai_providers.$inferSelect;
export type NewAiProvider    = typeof ai_providers.$inferInsert;
export type AiBot            = typeof ai_bots.$inferSelect;
export type NewAiBot         = typeof ai_bots.$inferInsert;
export type AiToolCall       = typeof ai_tool_calls.$inferSelect;
export type NewAiToolCall    = typeof ai_tool_calls.$inferInsert;
