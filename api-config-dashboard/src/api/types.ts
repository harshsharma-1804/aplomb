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
  /** Environment this app belongs to — shown in UI and X-Orchestrator-Mode header */
  mode: "dev" | "qa" | "staging" | "prod";
  /** App-scoped environment variables — use {{KEY}} in upstream URLs and header values */
  app_env: AppEnvVar[];
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

export interface Upstream {
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
}

export interface RequestConfig {
  content_type: "application/json" | "application/x-www-form-urlencoded";
  max_body_bytes: number;
  validation: "strict" | "permissive";
  input_schema: SchemaField[];
}

export interface Endpoint {
  _id: string;
  app_id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  is_active: boolean;
  path_params: PathParam[];
  request: RequestConfig;
  upstream: Upstream;
  query_params: QueryParam[];
  sample_response: { json: unknown; captured_at: string } | null;
  output_schema: SchemaField[];
  field_mappings: FieldMapping[];
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
