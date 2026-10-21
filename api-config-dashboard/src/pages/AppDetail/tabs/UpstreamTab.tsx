import { usePageSave } from "../../../components/PageSave";
import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type {
  App, Endpoint, QueryParam, PathParam, StaticHeader, ForwardedHeader,
  AppScript, ScriptMode, UpstreamType, MongoOperation, AppDbConnection,
} from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C, DeleteIcon } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props { appId: string; endpoint: Endpoint; app: App | null; onSaved: (ep: Endpoint) => void; }

const SCRIPT_MODE_LABELS: Record<ScriptMode, string> = {
  none:            "None",
  script_full:     "Full Handler",
  script_pre:      "Pre-hook",
  script_post:     "Post-hook",
  script_pre_post: "Pre + Post",
};

const SCRIPT_MODE_HINTS: Record<ScriptMode, string> = {
  none:            "No script — upstream config below is used as normal.",
  script_full:     "Script replaces the upstream entirely. Upstream config below is ignored.",
  script_pre:      "Script runs before the upstream call. Can modify the request or return early.",
  script_post:     "Script runs after the upstream call. Can modify or replace the response.",
  script_pre_post: "Pre-hook runs before the upstream call, post-hook runs after.",
};

const UPSTREAM_TYPES: { value: UpstreamType; label: string }[] = [
  { value: "http",       label: "HTTP / REST" },
  { value: "graphql",    label: "GraphQL" },
  { value: "mongodb",    label: "MongoDB" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql",      label: "MySQL" },
];

const MONGO_OPERATIONS: MongoOperation[] = [
  "find", "findOne", "insertOne", "updateOne", "updateMany",
  "deleteOne", "deleteMany", "aggregate", "count",
];

function mongoQueryPlaceholder(op: MongoOperation): string {
  switch (op) {
    case "updateOne":
    case "updateMany":  return '{ "filter": { "field": "{param}" }, "update": { "$set": { "field": "value" } } }';
    case "insertOne":   return '{ "field": "value" }';
    case "aggregate":   return '[ { "$match": { "field": "{param}" } } ]';
    default:            return '{ "field": "{param}" }';
  }
}

export function UpstreamTab({ appId, endpoint, app, onSaved }: Props) {
  const { can } = useSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Script config ──────────────────────────────────────────────────────────
  const [scriptMode, setScriptMode] = useState<ScriptMode>(endpoint.script_mode ?? "none");
  const [scriptFileId, setScriptFileId] = useState<string>(endpoint.script_file_id ?? "");
  const [scripts, setScripts] = useState<AppScript[]>([]);
  const [scriptSaving, setScriptSaving] = useState(false);
  const [scriptSaveOk, setScriptSaveOk] = useState(false);
  const [scriptError, setScriptError] = useState("");

  useEffect(() => {
    api.get<{ count: number; results: AppScript[] }>(`/__config/apps/${appId}/scripts`)
      .then(r => setScripts(r.results))
      .catch(() => {});
  }, [appId]);

  async function saveScriptConfig() {
    setScriptSaving(true); setScriptError(""); setScriptSaveOk(false);
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/script-config`, {
        script_mode: scriptMode,
        script_file_id: scriptFileId || null,
      });
      onSaved(ep);
      setScriptSaveOk(true);
    } catch (e) { setScriptError(String(e)); throw e; }
    finally { setScriptSaving(false); }
  }

  // ── Upstream type ──────────────────────────────────────────────────────────
  const [upstreamType, setUpstreamType] = useState<UpstreamType>(
    (endpoint.upstream?.upstream_type as UpstreamType) ?? "http"
  );

  // ── HTTP / GraphQL fields ──────────────────────────────────────────────────
  const [url, setUrl]             = useState(endpoint.upstream?.url ?? "");
  const [method, setMethod]       = useState(endpoint.upstream?.method ?? endpoint.method);
  const [authType, setAuthType]   = useState(endpoint.upstream?.auth_type ?? "forward_cookie");
  const [forwardCookies, setForwardCookies] = useState(endpoint.upstream?.forward_cookies ?? true);
  const [bodyContentType, setBodyContentType] = useState(endpoint.upstream?.body_content_type ?? "application/json");
  const [bodyPassthrough, setBodyPassthrough] = useState(endpoint.upstream?.body_passthrough ?? false);
  const [nestedEncoding, setNestedEncoding]   = useState(endpoint.upstream?.form_encoding?.nested ?? "bracket");
  const [arrayEncoding, setArrayEncoding]     = useState(endpoint.upstream?.form_encoding?.array ?? "repeat");
  const [boolEncoding, setBoolEncoding]       = useState(endpoint.upstream?.form_encoding?.boolean ?? "true_false");
  const [nullEncoding, setNullEncoding]       = useState(endpoint.upstream?.form_encoding?.null ?? "omit");
  const [staticHeaders, setStaticHeaders]     = useState<StaticHeader[]>(endpoint.upstream?.static_headers ?? []);
  const [forwardedHeaders, setForwardedHeaders] = useState<ForwardedHeader[]>(endpoint.upstream?.forwarded_headers ?? []);
  const [forwardAllHeaders, setForwardAllHeaders] = useState<boolean>(endpoint.upstream?.forward_all_headers ?? false);

  // ── DB connection registry ─────────────────────────────────────────────────
  const [dbConnections, setDbConnections] = useState<AppDbConnection[]>([]);
  const [dbConnectionId, setDbConnectionId] = useState<string>(
    endpoint.upstream?.db_connection_id ?? ""
  );

  useEffect(() => {
    api.get<{ results: AppDbConnection[] }>(`/__config/apps/${appId}/db-connections`)
      .then(r => setDbConnections(r.results))
      .catch(() => {});
  }, [appId]);

  // ── DB fields ──────────────────────────────────────────────────────────────
  const [dbUrl, setDbUrl]             = useState(endpoint.upstream?.db_url ?? "");
  const [dbUrlVisible, setDbUrlVisible] = useState(false);
  const [dbCollection, setDbCollection] = useState(endpoint.upstream?.db_collection ?? "");
  const [dbOperation, setDbOperation]   = useState<MongoOperation>(
    (endpoint.upstream?.db_operation as MongoOperation) ?? "find"
  );
  const [dbResultLimit, setDbResultLimit] = useState<number>(endpoint.upstream?.db_result_limit ?? 100);
  const [dbQueryTemplate, setDbQueryTemplate] = useState(endpoint.upstream?.db_query_template ?? "");
  const [dbQueryMode, setDbQueryMode] = useState<"rows" | "row">(endpoint.upstream?.db_query_mode ?? "rows");

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [queryParams, setQueryParams] = useState<QueryParam[]>(endpoint.query_params ?? []);
  const [pathParams, setPathParams]   = useState<PathParam[]>(endpoint.path_params ?? []);

  const isWriteMethod   = ["POST", "PUT", "PATCH"].includes(endpoint.method);
  const showFormEncoding = bodyContentType === "application/x-www-form-urlencoded";
  const isDbType        = upstreamType === "mongodb" || upstreamType === "postgresql" || upstreamType === "mysql";
  const isSqlType       = upstreamType === "postgresql" || upstreamType === "mysql";
  const showResultLimit = upstreamType === "mongodb" && (dbOperation === "find" || dbOperation === "aggregate");

  // Available placeholders for the hint bar
  const pathPlaceholders  = pathParams.map(p => ({ name: p.name, kind: "path"  as const }));
  const queryPlaceholders = queryParams.map(p => ({ name: p.frontend_param, kind: "query" as const }));
  const envPlaceholders   = (app?.app_env ?? []).map(e => ({ name: e.key, kind: "env" as const }));
  const allPlaceholders   = [...pathPlaceholders, ...queryPlaceholders, ...envPlaceholders];

  async function save() {
    setSaving(true); setError("");
    try {
      const upstream: Record<string, unknown> = {
        upstream_type: upstreamType,
        // HTTP/GraphQL fields (always saved — ignored at runtime for DB types)
        url, method,
        forward_cookies: forwardCookies,
        auth_type: authType,
        auth_config: endpoint.upstream?.auth_config ?? {},
        body_content_type: bodyContentType,
        body_passthrough: bodyPassthrough,
        form_encoding: { nested: nestedEncoding, array: arrayEncoding, boolean: boolEncoding, null: nullEncoding },
        body_mappings: endpoint.upstream?.body_mappings ?? [],
        static_headers: staticHeaders,
        forwarded_headers: forwardedHeaders.map(fh => ({ from_name: fh.from_name.trim(), to_name: fh.to_name.trim(), required: fh.required })),
        forward_all_headers: forwardAllHeaders,
      };

      if (isDbType || upstreamType === "graphql") {
        upstream.db_connection_id  = dbConnectionId || undefined;
        upstream.db_url            = dbConnectionId ? undefined : dbUrl;
        upstream.db_collection     = dbCollection;
        upstream.db_operation      = dbOperation;
        upstream.db_result_limit   = dbResultLimit;
        upstream.db_query_template = dbQueryTemplate;
        upstream.db_query_mode     = dbQueryMode;
      }

      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`, {
        upstream,
        query_params: queryParams,
        path_params: pathParams,
      });
      onSaved(ep);
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  function addQueryParam()  { setQueryParams(p => [...p, { frontend_param: "", upstream_param: "", pass_through: true }]); }
  function removeQueryParam(i: number) { setQueryParams(p => p.filter((_, idx) => idx !== i)); }
  function updateQueryParam(i: number, k: keyof QueryParam, v: string | boolean) { setQueryParams(p => p.map((row, idx) => idx === i ? { ...row, [k]: v } : row)); }

  function addPathParam()  { setPathParams(p => [...p, { name: "", type: "string", required: true }]); }
  function removePathParam(i: number) { setPathParams(p => p.filter((_, idx) => idx !== i)); }
  function updatePathParam(i: number, k: keyof PathParam, v: string | boolean) { setPathParams(p => p.map((row, idx) => idx === i ? { ...row, [k]: v } : row)); }

  usePageSave({upstreamType,url,method,authType,forwardCookies,bodyContentType,bodyPassthrough,nestedEncoding,arrayEncoding,boolEncoding,nullEncoding,staticHeaders,forwardedHeaders,forwardAllHeaders,dbConnectionId,dbUrl,dbCollection,dbOperation,dbResultLimit,dbQueryTemplate,dbQueryMode,queryParams,pathParams},save,{enabled:can("edit:endpoints"),disabled:saving});
  usePageSave({scriptMode,scriptFileId},saveScriptConfig,{enabled:can("edit:endpoints"),disabled:scriptSaving});

  const readonly = !can("edit:endpoints");
  const scriptActive = scriptMode !== "none";
  const saveBtn = !readonly ? <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn> : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* ── Provider Type Selector ───────────────────────────────────── */}
      <Card>
        <SectionHead title="Provider Type" action={saveBtn} />
        <div style={{ padding: 16 }}>
          <div className="ui-seg">
            {UPSTREAM_TYPES.map(t => (
              <button key={t.value}
                onClick={() => { if (!readonly) setUpstreamType(t.value); }}
                className={`ui-seg__item ${upstreamType===t.value ? "is-active" : ""}`} disabled={readonly}>
                {t.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>
            {upstreamType === "http"       && "Standard HTTP/REST — configure a URL, method, auth, and headers below."}
            {upstreamType === "graphql"    && "GraphQL over HTTP — always POSTs with { query, variables } from the request body. Configure the endpoint URL and auth below."}
            {upstreamType === "mongodb"    && "Direct MongoDB query — configure a connection URL, collection, operation, and query template below."}
            {upstreamType === "postgresql" && "Direct PostgreSQL query — configure a connection URL, query mode, and SQL template below."}
            {upstreamType === "mysql"      && "Direct MySQL/MariaDB query — configure a connection URL and SQL template below."}
          </p>
        </div>
      </Card>

      {/* ── Script Configuration ─────────────────────────────────────── */}
      <Card>
        <SectionHead
          title="Script"
          action={!readonly ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {scriptSaveOk && <span style={{ fontSize: 12, color: C.success }}>✓ Saved</span>}
              {scriptError  && <span style={{ fontSize: 12, color: C.danger }}>{scriptError}</span>}
              <Btn size="sm" pageSave onClick={saveScriptConfig} disabled={scriptSaving}>{scriptSaving ? "Saving…" : "Save"}</Btn>
            </div>
          ) : undefined}
        />
        <div style={{ padding: 16 }}>
          <Field label="Script Mode" hint={SCRIPT_MODE_HINTS[scriptMode]}>
            <div className="ui-seg">
              {(Object.keys(SCRIPT_MODE_LABELS) as ScriptMode[]).map(m => (
                <button key={m} onClick={() => { if (!readonly) { setScriptMode(m); setScriptSaveOk(false); } }}
                  className={`ui-seg__item ${scriptMode===m ? "is-active" : ""}`} disabled={readonly}>
                  {SCRIPT_MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </Field>

          {scriptMode !== "none" && (
            <Field label="Script File" hint={scripts.length === 0 ? "No scripts yet — go to the Scripts tab to create one." : "Select a script file from this app's Scripts library."}>
              <select
                style={{ ...inputStyle, borderColor: scriptActive && !scriptFileId ? C.danger : C.border }}
                value={scriptFileId}
                onChange={e => { setScriptFileId(e.target.value); setScriptSaveOk(false); }}
                disabled={readonly}
              >
                <option value="">— select a script file —</option>
                {scripts.map(s => <option key={s._id} value={s._id}>{s.filename}</option>)}
              </select>
              {scriptActive && !scriptFileId && (
                <p style={{ margin: "4px 0 0", fontSize: 11, color: C.danger }}>A script file must be selected when a script mode is active.</p>
              )}
            </Field>
          )}

          {scriptMode === "script_full" && (
            <div style={{ padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)" }}>
              Full Handler mode is active. The upstream configuration below is <strong>not used</strong> — your script is solely responsible for fetching data and returning a response.
            </div>
          )}
          {(scriptMode === "script_pre" || scriptMode === "script_pre_post") && (
            <div style={{ padding: "8px 12px", background: "var(--selection)", borderRadius: C.radius, border: "1px solid var(--border)", fontSize: 12, color: "var(--primary)" }}>
              Pre-hook is active. Your script's <code>preHook</code> runs before the upstream call below. Return a response to short-circuit, or return nothing to proceed.
            </div>
          )}
          {(scriptMode === "script_post" || scriptMode === "script_pre_post") && (
            <div style={{ padding: "8px 12px", background: "var(--success-background)", borderRadius: C.radius, border: "1px solid var(--success)", fontSize: 12, color: "var(--success)" }}>
              Post-hook is active. Your script's <code>postHook(ctx, upstreamBody)</code> runs after the upstream call and can reshape the response before the output transform.
            </div>
          )}
        </div>
      </Card>

      {/* ── HTTP / REST Connection Card ──────────────────────────────── */}
      {(upstreamType === "http" || upstreamType === "graphql") && (
        <Card>
          <SectionHead title={upstreamType === "graphql" ? "GraphQL Endpoint" : "Upstream Connection"} />
          <div style={{ padding: 16 }}>
            {upstreamType === "graphql" && (
              <div style={{ padding: "8px 12px", background: C.selection, borderRadius: C.radius, border: `1px solid ${C.border}`, fontSize: 12, color: C.primary, marginBottom: 12 }}>
                The caller's request body must contain <code>query</code> (string) and optionally <code>variables</code> (object).
                These are forwarded as-is to the GraphQL endpoint as a POST request.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: upstreamType === "graphql" ? "1fr" : "1fr 140px", gap: "0 12px" }}>
              <Field label={upstreamType === "graphql" ? "GraphQL Endpoint URL" : "Upstream URL"} hint={app?.app_env?.length ? "Use {{KEY}} to reference app environment variables" : undefined}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={url} onChange={e => setUrl(e.target.value)}
                    placeholder={upstreamType === "graphql" ? "https://api.example.com/graphql or {{GQL_URL}}" : "https://api.example.com/claims or {{BASE_URL}}/claims"}
                    disabled={readonly} />
                  {!readonly && app?.app_env?.length ? <EnvPicker envVars={app.app_env} onSelect={key => setUrl(v => v + `{{${key}}}`)} /> : null}
                </div>
              </Field>
              {upstreamType === "http" && (
                <Field label="Method">
                  <select style={inputStyle} value={method} onChange={e => setMethod(e.target.value)} disabled={readonly}>
                    {["GET","POST","PUT","DELETE","PATCH"].map(m => <option key={m}>{m}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field label="Auth Type">
                <select style={inputStyle} value={authType} onChange={e => setAuthType(e.target.value as any)} disabled={readonly}>
                  <option value="none">None</option>
                  <option value="forward_cookie">Forward Caller Token</option>
                  <option value="apikey">API Key (from Secrets)</option>
                  <option value="bearer">Bearer Token (from Secrets)</option>
                </select>
              </Field>
              <Field label="Forward Cookies">
                <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={forwardCookies} onChange={e => setForwardCookies(e.target.checked)} disabled={readonly} />
                  Forward caller's Authorization / Cookie header to upstream
                </label>
              </Field>
            </div>
            {authType !== "none" && authType !== "forward_cookie" && (
              <div style={{ padding: 12, background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 12 }}>
                API key and Bearer token values are stored as Secrets and referenced by ID. Go to <strong>Admin → Secrets</strong> to create or rotate values.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── HTTP Request Body ────────────────────────────────────────── */}
      {upstreamType === "http" && isWriteMethod && (
        <Card>
          <SectionHead title="Request Body (Outbound)" />
          <div style={{ padding: 16 }}>
            <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field label="Upstream Body Content-Type">
                <select style={inputStyle} value={bodyContentType} onChange={e => setBodyContentType(e.target.value as any)} disabled={readonly}>
                  <option value="application/json">application/json</option>
                  <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                </select>
              </Field>
              <Field label="Body Passthrough">
                <label style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={bodyPassthrough} onChange={e => setBodyPassthrough(e.target.checked)} disabled={readonly} />
                  Forward frontend body unchanged (mappings skipped, validation still applied)
                </label>
              </Field>
            </div>
            {showFormEncoding && (
              <div style={{ marginTop: 8, padding: 12, background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8 }}>FORM ENCODING CONVENTIONS</div>
                <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 12px" }}>
                  <Field label="Nested Objects">
                    <select style={inputStyle} value={nestedEncoding} onChange={e => setNestedEncoding(e.target.value as any)} disabled={readonly}>
                      <option value="bracket">bracket: a[b]=v</option>
                      <option value="dot">dot: a.b=v</option>
                      <option value="reject">reject nested</option>
                    </select>
                  </Field>
                  <Field label="Arrays">
                    <select style={inputStyle} value={arrayEncoding} onChange={e => setArrayEncoding(e.target.value as any)} disabled={readonly}>
                      <option value="repeat">repeat: k=a&k=b</option>
                      <option value="bracket">bracket: k[]=a</option>
                      <option value="indexed">indexed: k[0]=a</option>
                      <option value="comma">comma: k=a,b</option>
                    </select>
                  </Field>
                  <Field label="Booleans">
                    <select style={inputStyle} value={boolEncoding} onChange={e => setBoolEncoding(e.target.value as any)} disabled={readonly}>
                      <option value="true_false">true/false</option>
                      <option value="one_zero">1/0</option>
                    </select>
                  </Field>
                  <Field label="Null Values">
                    <select style={inputStyle} value={nullEncoding} onChange={e => setNullEncoding(e.target.value as any)} disabled={readonly}>
                      <option value="omit">omit (key absent)</option>
                      <option value="empty">empty string (key=)</option>
                    </select>
                  </Field>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── DB Connection Card ───────────────────────────────────────── */}
      {isDbType && (
        <Card>
          <SectionHead title="Database Connection" />
          <div style={{ padding: 16 }}>

            {/* Connection picker */}
            {dbConnections.length > 0 ? (
              <Field label="Connection" hint="Select a named connection configured in App → Settings → Database Connections">
                <select
                  style={inputStyle}
                  value={dbConnectionId}
                  onChange={e => setDbConnectionId(e.target.value)}
                  disabled={readonly}
                >
                  <option value="">— select a connection —</option>
                  {dbConnections
                    .filter(c => c.db_type === upstreamType)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.host}/{c.database})
                      </option>
                    ))}
                  {dbConnections.filter(c => c.db_type !== upstreamType).length > 0 && (
                    <optgroup label={`Other types (incompatible with ${upstreamType})`}>
                      {dbConnections
                        .filter(c => c.db_type !== upstreamType)
                        .map(c => (
                          <option key={c.id} value={c.id} disabled>
                            {c.name} [{c.db_type}]
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
                {!dbConnectionId && (
                  <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0" }}>
                    No connection selected — you can enter a raw URL below instead.
                  </p>
                )}
              </Field>
            ) : (
              <div style={{ padding: "8px 12px", background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted, marginBottom: 12 }}>
                No named connections yet.{" "}
                <strong>Go to App → Settings → Database Connections</strong> to add one, then come back to select it here.
                You can also enter a raw URL below.
              </div>
            )}

            {/* Raw URL fallback — shown when no named connection selected */}
            {!dbConnectionId && (
              <Field label="Raw Connection URL (fallback)" hint="Used only when no named connection is selected above. Supports {{ENV_VAR}} and {{SECRET_KEY}}.">
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type={dbUrlVisible ? "text" : "password"}
                    style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }}
                    value={dbUrl}
                    onChange={e => setDbUrl(e.target.value)}
                    placeholder={
                      upstreamType === "mongodb"    ? "mongodb://host:27017/mydb  or  {{MONGO_URL}}" :
                      upstreamType === "postgresql" ? "postgresql://user:pass@host:5432/db  or  {{PG_URL}}" :
                                                      "mysql://user:pass@host:3306/db  or  {{MYSQL_URL}}"
                    }
                    disabled={readonly}
                    autoComplete="off"
                  />
                  <button
                    onClick={() => setDbUrlVisible(v => !v)}
                    title={dbUrlVisible ? "Hide URL" : "Show URL"}
                    style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.surface, cursor: "pointer", fontSize: 14 }}
                  >
                    {dbUrlVisible ? "🙈" : "👁"}
                  </button>
                  {!readonly && app?.app_env?.length ? <EnvPicker envVars={app.app_env} onSelect={key => setDbUrl(v => v + `{{${key}}}`)} /> : null}
                </div>
              </Field>
            )}

            {/* Selected connection summary */}
            {dbConnectionId && (() => {
              const sel = dbConnections.find(c => c.id === dbConnectionId);
              return sel ? (
                <div style={{ padding: "8px 12px", background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}`, fontSize: 12, marginTop: 4 }}>
                  <span style={{ marginRight: 10 }}>🔌 <strong>{sel.name}</strong></span>
                  <span style={{ color: C.muted, marginRight: 10 }}>{sel.host}/{sel.database}</span>
                  {sel.username && <span style={{ color: C.muted, marginRight: 10 }}>user: {sel.username}</span>}
                  {sel.secret_id && <span style={{ color: C.muted }}>🔒 password from Secrets</span>}
                </div>
              ) : null;
            })()}

            {/* MongoDB operation fields */}
            {upstreamType === "mongodb" && (
              <>
                <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", marginTop: 12 }}>
                  <Field label="Collection">
                    <input style={inputStyle} value={dbCollection} onChange={e => setDbCollection(e.target.value)} placeholder="collection name" disabled={readonly} />
                  </Field>
                  <Field label="Operation">
                    <select style={inputStyle} value={dbOperation} onChange={e => setDbOperation(e.target.value as MongoOperation)} disabled={readonly}>
                      {MONGO_OPERATIONS.map(op => <option key={op} value={op}>{op}</option>)}
                    </select>
                  </Field>
                </div>
                {showResultLimit && (
                  <Field label="Result Limit" hint="Maximum documents returned (default 100). Applies to find and aggregate.">
                    <input type="number" style={{ ...inputStyle, width: 120 }} value={dbResultLimit} min={1} max={10000}
                      onChange={e => setDbResultLimit(Number(e.target.value))} disabled={readonly} />
                  </Field>
                )}
              </>
            )}

            {/* PostgreSQL query mode */}
            {upstreamType === "postgresql" && (
              <div style={{ marginTop: 12 }}>
              <Field label="Query Mode" hint='"rows" returns all matching rows as array. "row" returns first row as object.'>
                <select style={{ ...inputStyle, width: 220 }} value={dbQueryMode} onChange={e => setDbQueryMode(e.target.value as "rows" | "row")} disabled={readonly}>
                  <option value="rows">rows — return all rows as array</option>
                  <option value="row">row — return first row as object</option>
                </select>
              </Field>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Query Template Card ──────────────────────────────────────── */}
      {isDbType && (
        <Card>
          <SectionHead title={isSqlType ? "SQL Template" : "Query Template"} />
          <div style={{ padding: 16 }}>
            {/* Placeholder hint bar */}
            {allPlaceholders.length > 0 && (
              <div style={{ padding: "8px 12px", background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}`, marginBottom: 10, fontSize: 12 }}>
                <span style={{ color: C.muted, fontWeight: 600, marginRight: 8 }}>Available placeholders:</span>
                {pathPlaceholders.map(p => (
                  <span key={p.name} style={{ marginRight: 10 }}>
                    <code style={{ color: C.primary }}>{`{${p.name}}`}</code>
                    {isSqlType && seenSqlIndex(p.name, [...pathPlaceholders, ...queryPlaceholders], upstreamType) !== null &&
                      <span style={{ color: C.muted }}> → {upstreamType === "postgresql" ? `$${seenSqlIndex(p.name, [...pathPlaceholders, ...queryPlaceholders], upstreamType)}` : "?"}</span>
                    }
                    <span style={{ color: C.muted, marginLeft: 4 }}>(path)</span>
                  </span>
                ))}
                {queryPlaceholders.map(p => (
                  <span key={p.name} style={{ marginRight: 10 }}>
                    <code style={{ color: C.primary }}>{`{${p.name}}`}</code>
                    {isSqlType && seenSqlIndex(p.name, [...pathPlaceholders, ...queryPlaceholders], upstreamType) !== null &&
                      <span style={{ color: C.muted }}> → {upstreamType === "postgresql" ? `$${seenSqlIndex(p.name, [...pathPlaceholders, ...queryPlaceholders], upstreamType)}` : "?"}</span>
                    }
                    <span style={{ color: C.muted, marginLeft: 4 }}>(query)</span>
                  </span>
                ))}
                {envPlaceholders.map(p => (
                  <span key={p.name} style={{ marginRight: 10 }}>
                    <code style={{ color: "#b37feb" }}>{`{{${p.name}}}`}</code>
                    <span style={{ color: C.muted, marginLeft: 4 }}>(env var{isSqlType ? " — inlined" : ""})</span>
                  </span>
                ))}
              </div>
            )}

            <textarea
              style={{
                ...inputStyle,
                display: "block", width: "100%", minHeight: 140,
                fontFamily: "monospace", fontSize: 12, resize: "vertical",
                boxSizing: "border-box",
              }}
              value={dbQueryTemplate}
              onChange={e => setDbQueryTemplate(e.target.value)}
              placeholder={
                isSqlType
                  ? `SELECT * FROM table_name WHERE id = {${pathParams[0]?.name || "claimId"}}`
                  : mongoQueryPlaceholder(dbOperation)
              }
              disabled={readonly}
            />

            {isSqlType && (
              <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0" }}>
                <code>{"{paramName}"}</code> placeholders are bound as parameterized values
                {upstreamType === "postgresql" ? " ($1, $2, …)" : " (?)"}
                {" "}— safe from SQL injection.
                <code>{"{{ENV_VAR}}"}</code> references are substituted from app environment variables before execution.
              </p>
            )}
            {upstreamType === "mongodb" && (
              <p style={{ fontSize: 11, color: C.muted, margin: "6px 0 0" }}>
                JSON filter / pipeline / document depending on operation. Leave empty to accept the full query from the request body (advanced — not recommended for external-facing endpoints).
              </p>
            )}
          </div>
        </Card>
      )}

      {/* ── Path Parameters ─────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Path Parameters" action={!readonly ? <Btn size="sm" variant="ghost" onClick={addPathParam}>+ Add</Btn> : undefined} />
        <div style={{ padding: 16 }}>
          {isDbType && (
            <p style={{ fontSize: 11, color: C.muted, margin: "0 0 10px", padding: "6px 10px", background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
              Path param names defined here are available as <code>{"{paramName}"}</code> placeholders in the query template above.
            </p>
          )}
          {pathParams.length === 0 ? <p style={{ fontSize: 12, color: C.muted }}>No path parameters. Use {`{paramName}`} in the endpoint path to define them.</p> : null}
          {pathParams.map((pp, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px auto auto", gap: "0 8px", marginBottom: 8, alignItems: "center" }}>
              <input style={inputStyle} value={pp.name} onChange={e => updatePathParam(i, "name", e.target.value)} placeholder="paramName" disabled={readonly} />
              <select style={inputStyle} value={pp.type} onChange={e => updatePathParam(i, "type", e.target.value)} disabled={readonly}>
                <option value="string">string</option>
                <option value="number">number</option>
              </select>
              <label style={{ display: "flex", gap: 4, fontSize: 12, alignItems: "center" }}>
                <input type="checkbox" checked={pp.required} onChange={e => updatePathParam(i, "required", e.target.checked)} disabled={readonly} />required
              </label>
              {!readonly && <DeleteIcon onClick={() => removePathParam(i)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }} label="Remove item" />}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Query Params Forwarding ──────────────────────────────────── */}
      <Card>
        <SectionHead title="Query Params Forwarding" action={!readonly ? <Btn size="sm" variant="ghost" onClick={addQueryParam}>+ Add</Btn> : undefined} />
        <div style={{ padding: 16 }}>
          {isDbType && (
            <p style={{ fontSize: 11, color: C.muted, margin: "0 0 10px", padding: "6px 10px", background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
              Query param frontend names defined here are available as <code>{"{paramName}"}</code> placeholders in the query template above.
            </p>
          )}
          {queryParams.length === 0 && <p style={{ fontSize: 12, color: C.muted }}>No query param rules yet.</p>}
          {queryParams.map((qp, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto auto", gap: "0 8px", marginBottom: 8, alignItems: "center" }}>
              <input style={inputStyle} value={qp.frontend_param} onChange={e => updateQueryParam(i, "frontend_param", e.target.value)} placeholder="frontend param" disabled={readonly} />
              <input style={inputStyle} value={qp.upstream_param} onChange={e => updateQueryParam(i, "upstream_param", e.target.value)} placeholder="upstream param" disabled={readonly} />
              <label style={{ display: "flex", gap: 4, fontSize: 12, alignItems: "center" }}>
                <input type="checkbox" checked={qp.pass_through} onChange={e => updateQueryParam(i, "pass_through", e.target.checked)} disabled={readonly} />pass
              </label>
              <input style={{ ...inputStyle, width: 80 }} value={qp.default_value ?? ""} onChange={e => updateQueryParam(i, "default_value", e.target.value)} placeholder="default" disabled={readonly} />
              {!readonly && <DeleteIcon onClick={() => removeQueryParam(i)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }} label="Remove item" />}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Static Headers (HTTP / GraphQL only) ────────────────────── */}
      {!isDbType && (
        <Card>
          <SectionHead
            title="Static Headers"
            action={!readonly ? <Btn size="sm" variant="ghost" onClick={() => setStaticHeaders(h => [...h, { name: "", value: "" }])}>+ Add</Btn> : undefined}
          />
          <div style={{ padding: 16 }}>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: staticHeaders.length ? 10 : 0 }}>
              Headers always sent to the upstream with a fixed value — e.g. <code>X-API-Version: 2</code>, <code>Accept: application/json</code>.
            </p>
            {staticHeaders.map((sh, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0 8px", marginBottom: 8, alignItems: "center" }}>
                <input style={inputStyle} value={sh.name}
                  onChange={e => setStaticHeaders(h => h.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  placeholder="Header-Name" disabled={readonly} />
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input style={{ ...inputStyle, flex: 1 }} value={sh.value}
                    onChange={e => setStaticHeaders(h => h.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                    placeholder="value or {{ENV_KEY}}" disabled={readonly} />
                  {!readonly && app?.app_env?.length ? <EnvPicker envVars={app.app_env} onSelect={key => setStaticHeaders(h => h.map((x, j) => j === i ? { ...x, value: x.value + `{{${key}}}` } : x))} /> : null}
                </div>
                {!readonly && (
                  <DeleteIcon onClick={() => setStaticHeaders(h => h.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }} label="Remove item" />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Header Forwarding Rules (HTTP / GraphQL only) ────────────── */}
      {!isDbType && (
        <Card>
          <SectionHead
            title="Header Forwarding Rules"
            action={!readonly ? <Btn size="sm" variant="ghost" onClick={() => setForwardedHeaders(h => [...h, { from_name: "", to_name: "", required: false }])}>+ Add</Btn> : undefined}
          />
          <div style={{ padding: 16 }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: C.radius, border: `1px solid ${forwardAllHeaders ? C.primary : C.border}`, background: forwardAllHeaders ? C.selection : C.surface, marginBottom: 12, cursor: readonly ? "default" : "pointer" }}>
              <input type="checkbox" checked={forwardAllHeaders} onChange={e => !readonly && setForwardAllHeaders(e.target.checked)} disabled={readonly} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Forward all headers as-is</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  Pass every safe header from the incoming request directly to the upstream — no configuration needed.
                  Individual rules below still run after and can override any header.
                </div>
              </div>
            </label>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: forwardedHeaders.length ? 10 : 0 }}>
              {forwardAllHeaders
                ? "All safe headers are already forwarded. Use the rules below to rename specific headers or enforce required ones."
                : "Forward specific headers from the frontend request to the upstream. Optionally rename them."}
            </p>
            {forwardedHeaders.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: "0 8px", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>FRONTEND SENDS</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>UPSTREAM RECEIVES</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>REQUIRED</span>
                <span />
              </div>
            )}
            {forwardedHeaders.map((fh, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: "0 8px", marginBottom: 8, alignItems: "center" }}>
                <input style={inputStyle} value={fh.from_name}
                  onChange={e => setForwardedHeaders(h => h.map((x, j) => j === i ? { ...x, from_name: e.target.value } : x))}
                  placeholder="X-Correlation-ID" disabled={readonly} />
                <input style={{ ...inputStyle, borderColor: fh.to_name && fh.to_name !== fh.from_name ? "var(--warning)" : C.border }}
                  value={fh.to_name}
                  onChange={e => setForwardedHeaders(h => h.map((x, j) => j === i ? { ...x, to_name: e.target.value } : x))}
                  placeholder={fh.from_name || "same name if blank"} disabled={readonly} />
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={fh.required}
                    onChange={e => setForwardedHeaders(h => h.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                    disabled={readonly} />
                  <span style={{ color: fh.required ? C.danger : C.muted }}>required</span>
                </label>
                {!readonly && (
                  <DeleteIcon onClick={() => setForwardedHeaders(h => h.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }} label="Remove item" />
                )}
              </div>
            ))}
            {forwardedHeaders.length === 0 && (
              <p style={{ fontSize: 12, color: C.muted }}>No forwarding rules. Auth headers are handled by the auth type setting above.</p>
            )}
            {forwardedHeaders.some(fh => fh.required) && (
              <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--danger-background)", borderRadius: C.radius, fontSize: 12, color: C.danger }}>
                Required headers: if the frontend does not send them, Aplomb returns <code>400 REQUIRED_HEADER_MISSING</code>.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Helper: compute SQL bind index for a param name (PostgreSQL only) ─────────
// For the hint bar — shows {param} → $1, $2, etc. in order of first appearance
// among the combined path+query param list.
function seenSqlIndex(
  name: string,
  allParams: Array<{ name: string }>,
  dbType: string
): number | null {
  if (dbType !== "postgresql") return null;
  const idx = allParams.findIndex(p => p.name === name);
  return idx >= 0 ? idx + 1 : null;
}

// ── Env Picker — inserts {{KEY}} at the cursor ────────────────────────────────

function EnvPicker({ envVars, onSelect }: { envVars: Array<{ key: string; value_type: string }>; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Insert environment variable reference"
        style={{ padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.surface, cursor: "pointer", fontSize: 12, color: C.primary, fontFamily: "monospace", fontWeight: 700 }}
      >
        {"{{}}"}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, boxShadow: C.shadow, zIndex: 100, minWidth: 200, maxHeight: 200, overflowY: "auto" }}>
          {envVars.map(v => (
            <button key={v.key} onClick={() => { onSelect(v.key); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={e => (e.currentTarget.style.background = C.bg)}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              <code style={{ color: C.primary }}>{`{{${v.key}}}`}</code>
              <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>{v.value_type === "secret" ? "🔒 secret" : "plain"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
