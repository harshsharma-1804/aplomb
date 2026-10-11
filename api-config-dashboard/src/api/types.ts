// ── Shared ────────────────────────────────────────────────────────────────────

export interface ListResult<T> {
  count: number;
  results: T[];
}

// ── Dashboard user ─────────────────────────────────────────────────────────────

export interface DashboardUser {
  id?: string;
  username: string;
  email: string;
  role: "admin" | "sub_admin" | "viewer";
  must_change_password?: boolean;
}

// ── Apps ──────────────────────────────────────────────────────────────────────

export interface AppEnvVar {
  key: string;
  value_type: "plain" | "secret";
  plain_value?: string;
  secret_id?: string | null;
  /** Only populated in UI reads — never the actual secret value */
  secret_name?: string;
}

export interface App {
  _id: string;
  name: string;
  base_path: string;
  description: string;
  status: "draft" | "active" | "deprecated";
  deprecated_at: string | null;
  allowed_provider_ids: string[];
  /** When false the runtime skips OIDC validation — dev/demo only */
  auth_required: boolean;
  /** Runtime authentication mode — see AppScopedSessions-9.md */
  auth_mode: "bearer" | "session" | "both";
  /** Which session login flow is live (when auth_mode ≠ bearer) */
  session_method: "gateway" | "identity" | "both";
  /** Session auth tuning */
  session_config: {
    cookie_name?: string;
    ttl_idle_min?: number;
    max_age_min?: number;
    max_sessions_per_user?: number;
    ua_enforce?: "off" | "flag" | "enforce";
    // ── Identity-provider login (see IdentityProviderLoginSpecs-3.md) ────────
    /** Allowlisted post-login redirect targets. Exact origin ("https://app.example.com")
     *  or origin+prefix ("https://app.example.com/dashboard"). Empty = redirects rejected. */
    login_redirect_allowlist?: string[];
    /** Default landing page after email verification. */
    post_login_redirect?: string;
    /** Attach a proven IdP identity to an existing verified gateway user (default true). */
    link_identity_on_verified_email?: boolean;
    /** Require verified email before gateway login (self-signup users). Default true. */
    require_email_verification?: boolean;
    /** Allow gateway users to self-enroll in two-factor auth (default true). */
    twofa_available?: boolean;
  /** Max failed login attempts per IP before 429 (default 10, min 3, max 100). */
  login_rate_limit_max?: number;
  /** Rate-limit window in minutes (default 15, min 1, max 60). */
  login_rate_limit_window_min?: number;
  /** Max consecutive failures per username before account is locked (default 5, 0 = disabled). */
  lockout_max_attempts?: number;
  /** Duration in minutes the account stays locked (default 30). */
  lockout_duration_min?: number;
};
  /** When true the app's endpoints are exposed to the AI chat agent and MCP clients */
  ai_expose: boolean;
  /** Environment this app belongs to — shown in UI and X-Orchestrator-Mode header */
  mode: "dev" | "qa" | "staging" | "prod";
  /** App-scoped environment variables — use {{KEY}} in upstream URLs and header values */
  app_env: AppEnvVar[];
  /** When set, every login/auth request must carry X-Frontend-Key matching this hash (true = key exists) */
  frontend_key_set: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Schema fields ─────────────────────────────────────────────────────────────

export interface SchemaField {
  id: string;
  field_path: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  /** For array fields: the primitive type of each element when items are not objects.
   *  When item_type = "object" (or absent), item_schema defines the element shape. */
  item_type?: "string" | "number" | "boolean" | "object";
  nullable: boolean;
  description: string;
  sort_order: number;
  /** Used for both object (child properties) and array (element shape when item_type = "object") */
  item_schema?: SchemaField[];
}

// ── Body & field mappings ─────────────────────────────────────────────────────

export interface FieldMapping {
  schema_field_id: string;
  upstream_path?: string;
  static_value?: string;
  mapping_type: "direct" | "static" | "array";
  item_mappings?: FieldMapping[];
}

export interface BodyMapping {
  upstream_path: string;
  mapping_type: "direct" | "static" | "principal" | "array";
  source?: "input" | "query" | "path";
  input_path?: string;
  query_param?: string;
  path_param?: string;
  claim?: string;
  static_value?: string;
  item_mappings?: BodyMapping[];
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

export interface QueryParam {
  frontend_param: string;
  upstream_param: string;
  pass_through: boolean;
  default_value?: string;
}

export interface PathParam {
  name: string;
  type: string;
  required: boolean;
}

export interface FormEncoding {
  nested: "bracket" | "dot" | "reject";
  array: "repeat" | "bracket" | "indexed" | "comma";
  boolean: "true_false" | "one_zero";
  null: "omit" | "empty";
}

export interface StaticHeader {
  name: string;
  value: string;
}

export interface ForwardedHeader {
  from_name: string;
  to_name: string;
  required: boolean;
}

export type UpstreamType = "http" | "graphql" | "mongodb" | "postgresql" | "mysql";

export type MongoOperation =
  | "find" | "findOne" | "insertOne"
  | "updateOne" | "updateMany"
  | "deleteOne" | "deleteMany"
  | "aggregate" | "count";

export interface Upstream {
  /** Provider type — determines which fields below are relevant */
  upstream_type: UpstreamType;

  // ── HTTP / GraphQL ────────────────────────────────────────────────────────
  url: string;
  method: string;
  forward_cookies: boolean;
  auth_type: "none" | "forward_cookie" | "apikey" | "bearer";
  auth_config: { header_name?: string; secret_ref?: string | null };
  body_content_type: "application/json" | "application/x-www-form-urlencoded";
  body_passthrough: boolean;
  form_encoding: FormEncoding;
  body_mappings: BodyMapping[];
  /** Static headers always sent to the upstream with a fixed value */
  static_headers: StaticHeader[];
  /** Rules to forward / rename headers from the frontend request to the upstream */
  forwarded_headers: ForwardedHeader[];
  /** When true all safe incoming request headers are forwarded to upstream */
  forward_all_headers: boolean;

  // ── Database (mongodb / postgresql / mysql) ───────────────────────────────
  /** Connection URL — supports {{SECRET_KEY}} and {{ENV_VAR}} substitution */
  db_url?: string;
  /** MongoDB only: collection name */
  db_collection?: string;
  /** MongoDB only: operation */
  db_operation?: MongoOperation;
  /** MongoDB find/aggregate: max documents returned (default 100) */
  db_result_limit?: number;
  /** Query template with {pathParam} and {queryParam} placeholders */
  db_query_template?: string;
  /** PostgreSQL only: "rows" (array) or "row" (first row object) */
  db_query_mode?: "rows" | "row";
}

export interface RequestConfig {
  content_type: "application/json" | "application/x-www-form-urlencoded";
  max_body_bytes: number;
  validation: "strict" | "permissive";
  input_schema: SchemaField[];
}

export type ScriptMode = "none" | "script_full" | "script_pre" | "script_post" | "script_pre_post";
export type ScriptLanguage = "javascript" | "typescript";

export interface AppScript {
  _id: string;
  app_id: string;
  filename: string;
  language: ScriptLanguage;
  source: string;
  compiled?: string;
  description: string;
  folder: string | null;
  created_at: string;
  updated_at: string;
}

export interface Endpoint {
  _id: string;
  app_id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  is_active: boolean;
  folder: string | null;
  path_params: PathParam[];
  request: RequestConfig;
  upstream: Upstream;
  query_params: QueryParam[];
  /** Argument names that carry the end-user identity — forced to the session's verified ID in session mode */
  identity_args?: string[];
  sample_response: { json: unknown; captured_at: string } | null;
  output_schema: SchemaField[];
  field_mappings: FieldMapping[];
  script_mode: ScriptMode;
  script_file_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface IdentityProvider {
  _id: string;
  name: string;
  type: "oidc";
  issuer: string;
  jwks_uri: string | null;
  audience: string[];
  algorithms: string[];
  claim_mappings: { subject: string; email: string; roles: string };
  clock_tolerance_sec: number;
  // Brokered login (OAuth code+PKCE) — see IdentityProviderLoginSpecs-3.md.
  // The client secret lives in the Secrets vault; only the ref is ever returned.
  client_id: string | null;
  client_secret_ref: string | null;
  scopes: string;
  is_active: boolean;
  created_at: string;
}

export interface AdminUser {
  _id: string;
  username: string;
  email: string;
  role: "admin" | "sub_admin" | "viewer";
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Secret {
  _id: string;
  name: string;
  description: string;
  value: string;
  created_at: string;
  rotated_at: string | null;
  last_used_at: string | null;
}

// ── Mail (SMTP senders + purpose routing) ─────────────────────────────────────

export interface MailSender {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password_set: boolean;
  from_address: string;
  from_name: string;
  is_active: boolean;
}

export interface MailRoute {
  id: string;
  purpose: string;
  app_id: string | null;   // null = org default
  sender_id: string;
}

// ── Organization ─────────────────────────────────────────────────────────────

export interface Organization {
  _id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

// ── Host Allowlist ────────────────────────────────────────────────────────────

export interface HostAllowlistEntry {
  _id: string;
  org_id: string;
  hostname: string;
  description: string;
  is_wildcard: boolean;
  created_at: string;
}

// ── AI / Bots ─────────────────────────────────────────────────────────────────

// ── App sessions & app users (AppScopedSessions-9) ────────────────────────────

export interface AppUser {
  id: string;
  app_id: string;
  username: string;
  email: string;
  sub: string;
  display_name: string | null;
  is_active: boolean;
  /** Sticky login method — fixed at creation (IdentityProviderLoginSpecs-3.md) */
  auth_method: "gateway" | "identity";
  identity_provider_id: string | null;
  idp_sub: string | null;
  /** Username-level lockout */
  failed_login_attempts: number;
  locked_until: string | null;
  is_locked: boolean;
  /** Gateway self-signup users verify via email link; operator-created and identity users are trusted */
  email_verified: boolean;
  last_login_at: string | null;
  // Two-factor (Features/TwoFactorAuth-11.md)
  twofa_status: "off" | "enabled" | "enforced";
  twofa_method: "totp" | "email_otp" | null;
  twofa_enrolled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppSessionSummary {
  id: string;
  app_id: string;
  sub: string;
  email: string | null;
  issuer: string;
  device_label: string;
  last_seen_ip: string | null;
  last_active_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  created_at: string;
  is_current?: boolean;
}

export interface BotLimits {
  max_tool_calls?: number;
  max_history_messages?: number;
  timeout_ms?: number;
  /** Max /__ai/chat + /mcp requests per minute (0/absent = unlimited) */
  rate_limit_per_min?: number;
  // Scope enforcement
  scope_enforcement?: boolean;
  scope_description?: string;
  scope_classification_prompt?: string;
  out_of_scope_message?: string;
  scope_context_messages?: number;
  // Hard behaviour controls
  tool_only_mode?: boolean;
  tool_only_refusal?: string;
  topic_blocklist?: string[];
  fallback_message?: string;
  max_response_words?: number;
  scope_guard?: ScopeGuardConfig;
}

export interface ScopeGuardConfig {
  /** Disabled by default — upstream is the real authority on data access */
  enabled: boolean;
  /** Tool argument names treated as user identifiers (case-insensitive) */
  id_arg_names: string[];
  /** Optional JS regex — any arg value matching this is treated as a user ID */
  id_value_pattern?: string;
  /** Message returned to the LLM when a scope violation is detected */
  deny_message?: string;
}

export interface AppPermission { read: boolean; write: boolean; }
export type AppPermissionsMap = Record<string, AppPermission>;

export interface AiBot {
  _id: string;
  id: string;
  name: string;
  is_active: boolean;
  allowed_app_ids: string[];
  allowed_provider_ids: string[];
  app_permissions: AppPermissionsMap;
  rules: string[];
  persona: string;
  limits: BotLimits;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AiProvider {
  _id: string;
  id: string;
  name: string;
  base_url: string;
  model: string;
  secret_id: string | null;
  secret_name: string | null;
  /** true when secret_id is null — local/open models (Ollama, llama.cpp) that need no API key */
  no_auth: boolean;
  is_active: boolean;
  created_at: string;
}

export interface AiToolCall {
  _id: string;
  bot_id: string | null;
  bot_name: string;
  user_id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  outcome: "ok" | "tool_error" | "scope_violation" | "denied";
  detail: string | null;
  latency_ms: number;
  created_at: string;
}

// ── App Export / Import ───────────────────────────────────────────────────────

export type ExportEnvMode = "none" | "keys" | "values";

export interface ExportOptions {
  include: Array<"endpoints" | "scripts" | "bots">;
  env: ExportEnvMode;
}

/** Bot definition as it travels in an export bundle (app or standalone). */
export interface ExportedBot {
  name: string;
  is_active: boolean;
  persona: string;
  rules: string[];
  limits: Record<string, unknown>;
  /** App bindings by base_path — resolved against the target instance on import. */
  apps: Array<{ base_path: string; name: string; permission: { read: boolean; write: boolean } }>;
  provider_names: string[];
}

/** AI provider definition — API key material is never exported, only the secret NAME. */
export interface ExportedAiProvider {
  name: string;
  base_url: string;
  model: string;
  no_auth: boolean;
  secret_name: string | null;
  is_active: boolean;
}

/** Standalone bot bundle (kind: "bot") — independent of the app bundle. */
export interface BotExport {
  export_version: "1";
  kind: "bot";
  exported_at: string;
  exported_from: string;
  bots: ExportedBot[];
  ai_providers: ExportedAiProvider[];
}

export interface BotImportResult {
  bots_created: number;
  /** Newly generated bot keys — shown once, never retrievable again. */
  bot_keys: Array<{ name: string; api_key: string }>;
  warnings: string[];
}

export interface AppExport {
  export_version: "1";
  exported_at: string;
  exported_from: string;
  export_options: ExportOptions;
  app: Omit<App, "_id" | "org_id" | "created_at" | "updated_at" | "created_by" | "allowed_provider_ids"> & {
    allowed_provider_ids: [];
    app_env: Array<{ key: string; value_type: "plain" | "secret"; plain_value?: string }>;
  };
  endpoints: Array<Omit<Endpoint, "_id" | "app_id" | "created_at" | "updated_at" | "script_file_id"> & {
    script_filename: string | null;
    upstream: Upstream & { auth_config: { header_name?: string; secret_ref?: never; secret_ref_name?: string | null } };
  }>;
  scripts: Array<{
    filename: string;
    language: ScriptLanguage;
    source: string;
    description: string;
    folder: string | null;
  }>;
  bots?: ExportedBot[];
  ai_providers?: ExportedAiProvider[];
}

export interface ImportOptions {
  name?: string;
  base_path?: string;
  overwrite?: boolean;
}

export interface ImportResult {
  app: App;
  endpoints_created: number;
  scripts_created: number;
  bots_created: number;
  /** Newly generated bot keys — shown once, never retrievable again. */
  bot_keys: Array<{ name: string; api_key: string }>;
  warnings: string[];
}

// ── Version history ───────────────────────────────────────────────────────────

export interface VersionHistoryEntry {
  _id: string;
  app_id: string;
  change_type: string;
  changed_by: { user_id: string | null; username: string };
  description: string;
  snapshot: { app: unknown; endpoints: unknown[] };
  created_at: string;
}
