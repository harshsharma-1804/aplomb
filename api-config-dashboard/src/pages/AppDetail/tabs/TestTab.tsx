import { Laptop, Workflow, Server, Play } from "lucide-react";
import { useState } from "react";
import type { App, Endpoint } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C, Code, MethodBadge, Badge, DeleteIcon } from "../../../components";

interface Props { appId: string; endpoint: Endpoint; app: App | null; }

// upstreamRequest is either the HTTP shape or the DB shape
interface HttpUpstreamRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
}
interface DbUpstreamRequest {
  db_type: string;
  db_url_masked: string;
  operation?: string;
  collection?: string;
  resolved_query: string;
}
interface ScriptUpstreamRequest {
  mode: string;
  script: string;
}

interface TestResult {
  upstreamRequest?: HttpUpstreamRequest | DbUpstreamRequest | ScriptUpstreamRequest;
  upstream?: unknown;
  transformed?: unknown;
  validation?: Array<{ field_path: string; status: string; value?: unknown }>;
  transformError?: string | null;
  upstreamStatus?: number;
  error?: string;
  scriptLogs?: Array<{ level: string; message: string; ts: string }>;
}

const DB_TYPE_ICONS: Record<string, string> = { mongodb: "🍃", postgresql: "🐘", mysql: "🐬", graphql: "◈" };
const DB_TYPE_LABELS: Record<string, string> = { mongodb: "MongoDB", postgresql: "PostgreSQL", mysql: "MySQL", graphql: "GraphQL" };

function isDbUpstreamReq(r: unknown): r is DbUpstreamRequest {
  return typeof r === "object" && r !== null && "db_type" in r;
}
function isScriptUpstreamReq(r: unknown): r is ScriptUpstreamRequest {
  return typeof r === "object" && r !== null && "mode" in r;
}

export function TestTab({ appId, endpoint, app }: Props) {
  const [queryOverrides, setQueryOverrides] = useState<Array<{ k: string; v: string }>>([]);
  const [pathOverrides, setPathOverrides]   = useState<Record<string, string>>({});
  const [requestBody, setRequestBody]       = useState("");
  const [testHeaders, setTestHeaders]       = useState<Array<{ k: string; v: string }>>([]);
  const [running, setRunning]               = useState(false);
  const [result, setResult]                 = useState<TestResult | null>(null);
  const [error, setError]                   = useState("");
  const [activePanel, setActivePanel]       = useState<"upstream_request" | "upstream_response" | "transformed" | "validation">("transformed");

  const upstreamType: string = (endpoint.upstream as any)?.upstream_type ?? "http";
  const isDbType   = upstreamType === "mongodb" || upstreamType === "postgresql" || upstreamType === "mysql";
  const isGql      = upstreamType === "graphql";
  const isWriteMethod = ["POST", "PUT", "PATCH"].includes(endpoint.method);

  // Path param names derived from the path pattern
  const derivedParamNames = (endpoint.path.match(/\{([^}]+)\}/g) ?? []).map(m => m.slice(1, -1));
  const configuredParams  = endpoint.path_params ?? [];
  const pathParams = derivedParamNames.map(name =>
    configuredParams.find(p => p.name.toLowerCase() === name.toLowerCase()) ?? { name, type: "string", required: true }
  );
  const hasPathParams = pathParams.length > 0;

  // ── URL / query preview helpers ───────────────────────────────────────────
  function substituteParams(template: string): string {
    const lowerOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(pathOverrides)) lowerOverrides[k.toLowerCase()] = v;
    let out = template.replace(/\{([^}]+)\}/g, (match, name) => {
      const val = pathOverrides[name] ?? lowerOverrides[name.toLowerCase()];
      return val ? val : match;
    });
    out = out.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const envVar = app?.app_env?.find(e => e.key === key);
      if (!envVar) return `{{${key}}}`;
      return envVar.value_type === "secret" ? `[${key}]` : (envVar.plain_value ?? `{{${key}}}`);
    });
    return out;
  }

  // DB: substitute {param} in query template for preview
  function substituteQueryTemplate(): string {
    const tmpl = (endpoint.upstream as any)?.db_query_template ?? "";
    if (!tmpl) return "(empty)";
    const allParams = { ...Object.fromEntries((endpoint.query_params ?? []).map(q => [q.frontend_param, ""])), ...pathOverrides };
    let out = tmpl;
    for (const [k, v] of Object.entries(pathOverrides)) {
      out = out.replaceAll(`{${k}}`, v || `{${k}}`);
    }
    for (const qp of (endpoint.query_params ?? [])) {
      const val = queryOverrides.find(o => o.k === qp.frontend_param)?.v ?? "";
      if (val) out = out.replaceAll(`{${qp.frontend_param}}`, val);
    }
    return out;
  }

  const frontendUrlPreview = substituteParams(app ? `${app.base_path}${endpoint.path}` : endpoint.path);
  const upstreamUrlPreview = substituteParams((endpoint.upstream as any)?.url ?? "");

  async function run() {
    setRunning(true); setError(""); setResult(null);
    try {
      const testHeadersObj: Record<string, string> = {};
      testHeaders.forEach(({ k, v }) => { if (k.trim()) testHeadersObj[k.trim()] = v; });
      const queryObj: Record<string, string> = {};
      queryOverrides.forEach(({ k, v }) => { if (k) queryObj[k] = v; });

      const body: Record<string, unknown> = {
        path_params: pathOverrides,
        query_params: queryObj,
        test_headers: testHeadersObj,
      };

      // For GraphQL, request_body must have { query, variables }
      if (isGql && requestBody.trim()) {
        try { body["request_body"] = JSON.parse(requestBody); }
        catch { body["request_body"] = { query: requestBody }; }
      } else if (isWriteMethod && !isDbType && !isGql && requestBody.trim()) {
        try { body["request_body"] = JSON.parse(requestBody); }
        catch { body["request_body"] = requestBody; }
      }

      const resp = await fetch(`/__config/apps/${appId}/endpoints/${endpoint._id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await resp.json() as TestResult;
      if (!resp.ok) { setError((data as any).error ?? `HTTP ${resp.status}`); }
      else { setResult(data); setActivePanel("transformed"); }
    } catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  }

  const panels = [
    { key: "upstream_request",  label: isDbType ? "DB Request" : "Upstream Request" },
    { key: "upstream_response", label: "Raw Result" },
    { key: "transformed",       label: "Transformed Output" },
    { key: "validation",        label: "Schema Validation" },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title="Test Request"
          action={<Btn size="sm" onClick={run} disabled={running}>{running ? "Running…" : <><Play size={16} /> Run test</>}</Btn>}
        />
        <div style={{ padding: 16 }}>

          <div className="ui-flow" style={{marginBottom:20}}>
            <div className="ui-flow__node"><div className="ui-flow__label"><Laptop /> Client</div><MethodBadge method={endpoint.method} /><div className="ui-mono" style={{marginTop:8,overflowWrap:"anywhere"}}>{frontendUrlPreview}</div></div>
            <div className="ui-flow__edge" />
            <div className="ui-flow__node is-hub"><div className="ui-flow__label"><Workflow /> Orchestrator</div><div className="ui-row" style={{flexWrap:"wrap",gap:6}}><Badge text="Validate" /><Badge text={endpoint.script_mode === "script_full" ? "Script" : "Map"} /></div></div>
            <div className="ui-flow__edge" />
            <div className="ui-flow__node"><div className="ui-flow__label"><Server /> Upstream</div><MethodBadge method={isGql ? "POST" : endpoint.upstream?.method ?? endpoint.method} /><div className="ui-mono" style={{marginTop:8,overflowWrap:"anywhere"}}>{endpoint.script_mode === "script_full" ? "Handled by script" : isDbType ? DB_TYPE_LABELS[upstreamType] ?? upstreamType : upstreamUrlPreview || "Configure an upstream URL"}</div></div>
          </div>
          {isDbType && endpoint.upstream?.db_query_template && <div style={{marginBottom:20}}><Code value={substituteQueryTemplate()} title="Resolved query" /></div>}

          {/* ── Path params ── */}
          {hasPathParams && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Path Parameters
                {isDbType && <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 8 }}>— values are substituted as <code>{"{param}"}</code> placeholders in the query template</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pathParams.map(pp => (
                  <div key={pp.name} style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "0 8px", alignItems: "center" }}>
                    <code style={{ fontSize: 13, color: C.primary, fontWeight: 600 }}>{`{${pp.name}}`}</code>
                    <input
                      style={inputStyle}
                      value={pathOverrides[pp.name] ?? ""}
                      onChange={e => setPathOverrides(p => ({ ...p, [pp.name]: e.target.value }))}
                      placeholder={`value for ${pp.name}`}
                      autoFocus={pathParams.indexOf(pp) === 0}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Query param overrides ── */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Query Param Overrides
                {isDbType && <span style={{ fontWeight: 400, textTransform: "none", marginLeft: 8 }}>— substituted as <code>{"{param}"}</code> in the query template</span>}
              </span>
              <Btn size="sm" variant="ghost" onClick={() => setQueryOverrides(p => [...p, { k: "", v: "" }])}>+ Add</Btn>
            </div>
            {queryOverrides.length === 0 && (
              <p style={{ fontSize: 12, color: C.muted }}>
                {(endpoint.query_params ?? []).length > 0
                  ? `Configured params: ${(endpoint.query_params ?? []).map(q => q.frontend_param).join(", ")} — add overrides above to set their values for this test.`
                  : "No query params configured. Add overrides for ad-hoc testing."}
              </p>
            )}
            {queryOverrides.map((qo, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0 8px", marginBottom: 6 }}>
                <input style={inputStyle} value={qo.k} onChange={e => setQueryOverrides(p => p.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="param name" />
                <input style={inputStyle} value={qo.v} onChange={e => setQueryOverrides(p => p.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="value" />
                <DeleteIcon onClick={() => setQueryOverrides(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }} label="Remove item" />
              </div>
            ))}
          </div>

          {/* ── Test headers (HTTP only) ── */}
          {!isDbType && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Test Headers</span>
                  <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>added to this test run only</span>
                </div>
                <Btn size="sm" variant="ghost" onClick={() => setTestHeaders(h => [...h, { k: "", v: "" }])}>+ Add</Btn>
              </div>
              {testHeaders.length === 0 && (
                <p style={{ fontSize: 12, color: C.muted }}>
                  Add headers for this run — e.g. <code>Authorization: Bearer &lt;token&gt;</code>. Static headers from the Upstream tab are always included automatically.
                </p>
              )}
              {testHeaders.map((h, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0 8px", marginBottom: 6 }}>
                  <input style={inputStyle} value={h.k} onChange={e => setTestHeaders(p => p.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="Header-Name" />
                  <input style={inputStyle} value={h.v} onChange={e => setTestHeaders(p => p.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="value" />
                  <DeleteIcon onClick={() => setTestHeaders(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }} label="Remove item" />
                </div>
              ))}
            </div>
          )}

          {/* ── Request body (HTTP POST/PUT/PATCH) ── */}
          {isWriteMethod && !isDbType && (
            <Field label={isGql ? "GraphQL Query (paste { query, variables } JSON or bare query string)" : `Request Body (${endpoint.request?.content_type ?? "application/json"})`}>
              <textarea value={requestBody} onChange={e => setRequestBody(e.target.value)}
                style={{ ...inputStyle, height: isGql ? 120 : 100, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
                placeholder={isGql ? '{\n  "query": "{ __typename }",\n  "variables": {}\n}' : '{"key": "value"}'} />
            </Field>
          )}

          {/* ── Static headers hint (HTTP) ── */}
          {!isDbType && (endpoint.upstream as any)?.static_headers?.length > 0 && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--selection)", borderRadius: C.radius, fontSize: 12, color: "var(--primary)" }}>
              <strong>Static headers (always included):</strong>{" "}
              {(endpoint.upstream as any).static_headers.map((sh: any) => (
                <code key={sh.name} style={{ marginRight: 8 }}>{sh.name}: {sh.value}</code>
              ))}
            </div>
          )}
          {!isDbType && (endpoint.upstream as any)?.forwarded_headers?.length > 0 && (
            <div style={{ marginTop: 6, padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, fontSize: 12, color: "var(--warning)" }}>
              <strong>Header forwarding rules (not applied in test — simulate via Test Headers above):</strong>{" "}
              {(endpoint.upstream as any).forwarded_headers.map((fh: any) => (
                <code key={fh.from_name} style={{ marginRight: 8 }}>
                  {fh.from_name}{fh.to_name && fh.to_name !== fh.from_name ? ` → ${fh.to_name}` : ""}{fh.required ? " (required)" : ""}
                </code>
              ))}
            </div>
          )}

          {/* ── DB hint ── */}
          {isDbType && !(endpoint.upstream as any)?.db_connection_id && !(endpoint.upstream as any)?.db_url && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, fontSize: 12, color: "var(--warning)" }}>
              No database connection configured. Go to the <strong>Upstream tab</strong> and select a connection or enter a URL, then come back to test.
            </div>
          )}
        </div>
      </Card>

      {/* ── Results ── */}
      {result && (
        <Card>
          <SectionHead
            title={
              isDbType
                ? `Results — DB query returned ${Array.isArray(result.upstream) ? `${(result.upstream as any[]).length} row(s)` : "1 result"}`
                : `Results — upstream returned HTTP ${result.upstreamStatus ?? "?"}`
            }
          />
          <div className="ui-tabs" role="tablist" aria-label="Test results">
            {panels.map(p => <button role="tab" aria-selected={activePanel===p.key} key={p.key} className={`ui-tab ${activePanel===p.key ? "is-active" : ""}`} onClick={()=>setActivePanel(p.key as any)}>{p.label}</button>)}
          </div>
          <div style={{ padding: 16 }}>
            {result.transformError && <ErrorBanner message={`Transform error: ${result.transformError}`}/>}

            {activePanel === "upstream_request" && (
              isDbUpstreamReq(result.upstreamRequest)
                ? <DbRequestPanel req={result.upstreamRequest} />
                : isScriptUpstreamReq(result.upstreamRequest)
                  ? <Code value={JSON.stringify(result.upstreamRequest, null, 2)} title="Script request" />
                  : <HttpRequestPanel req={result.upstreamRequest as HttpUpstreamRequest} />
            )}
            {activePanel === "upstream_response" && (
              <Code value={JSON.stringify(result.upstream, null, 2) ?? "No data"} title="Upstream response" />
            )}
            {activePanel === "transformed" && (
              <Code value={JSON.stringify(result.transformed, null, 2) ?? "No data"} title="Transformed response" />
            )}
            {activePanel === "validation" && (
              <ValidationPanel validation={result.validation} />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Shared code block style ───────────────────────────────────────────────────

const codeStyle: React.CSSProperties = {
  margin: 0, padding: 12,
  background: "var(--code-bg)", color: "var(--code-text)",
  borderRadius: C.radius, fontSize: 11, overflowX: "auto", maxHeight: 400,
};

// ── DB request panel ──────────────────────────────────────────────────────────

function DbRequestPanel({ req }: { req: DbUpstreamRequest }) {
  const icon = DB_TYPE_ICONS[req.db_type] ?? "🗄";
  const label = DB_TYPE_LABELS[req.db_type] ?? req.db_type;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.surfaceMuted, color:C.text, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{label}</div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>{req.db_url_masked}</div>
        </div>
      </div>
      {req.collection && (
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", fontSize: 12, gap: 6 }}>
          <span style={{ color: C.muted, fontWeight: 600 }}>Collection</span>
          <code>{req.collection}</code>
        </div>
      )}
      {req.operation && (
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", fontSize: 12, gap: 6 }}>
          <span style={{ color: C.muted, fontWeight: 600 }}>Operation</span>
          <code>{req.operation}</code>
        </div>
      )}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>
          {req.db_type === "mongodb" ? "Resolved Query / Filter" : "Resolved SQL"}
        </div>
        <pre style={codeStyle}>{req.resolved_query}</pre>
      </div>
    </div>
  );
}

// ── HTTP request panel ────────────────────────────────────────────────────────

function HttpRequestPanel({ req }: { req?: HttpUpstreamRequest }) {
  if (!req) return <p style={{ fontSize: 12, color: C.muted }}>No request data</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ background: "var(--selection)", color: C.primary, padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 12 }}>{req.method}</span>
        <code style={{ fontSize: 12, wordBreak: "break-all" }}>{req.url}</code>
      </div>
      {req.headers && Object.keys(req.headers).length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>Headers</div>
          <pre style={codeStyle}>{Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
        </div>
      )}
      {req.body && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 4 }}>Body</div>
          <pre style={codeStyle}>{typeof req.body === "string" ? req.body : JSON.stringify(req.body, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ── Schema validation panel ───────────────────────────────────────────────────

function ValidationPanel({ validation }: { validation?: TestResult["validation"] }) {
  if (!validation || validation.length === 0) return <p style={{ fontSize: 12, color: C.muted }}>No output schema defined — configure one in the Output tab to see validation here.</p>;

  const statusColor: Record<string, string> = {
    matched: "var(--success)",
    missing: "var(--danger)",
    nullable_absent: "var(--warning)",
    type_mismatch: "var(--warning)",
  };

  const summary = {
    matched: validation.filter(v => v.status === "matched").length,
    missing: validation.filter(v => v.status === "missing").length,
    nullable: validation.filter(v => v.status === "nullable_absent").length,
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
        <span style={{ color: "var(--success)", fontWeight: 600 }}>✓ {summary.matched} matched</span>
        {summary.missing > 0   && <span style={{ color: "var(--danger)",  fontWeight: 600 }}>✗ {summary.missing} missing</span>}
        {summary.nullable > 0  && <span style={{ color: "var(--warning)", fontWeight: 600 }}>◌ {summary.nullable} nullable absent</span>}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--surface-muted)" }}>
            {["Field Path", "Status", "Value"].map(h => (
              <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {validation.map((v, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>{v.field_path}</td>
              <td style={{ padding: "6px 10px" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: statusColor[v.status] ?? C.muted }}>
                  {v.status.replace(/_/g, " ").toUpperCase()}
                </span>
              </td>
              <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11, color: C.muted }}>
                {v.value !== undefined ? JSON.stringify(v.value) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
