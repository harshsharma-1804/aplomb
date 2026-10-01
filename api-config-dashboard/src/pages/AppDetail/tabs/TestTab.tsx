import { useState } from "react";
import type { App, Endpoint } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C } from "../../../components";

interface Props { appId: string; endpoint: Endpoint; app: App | null; }

interface TestResult {
  upstreamRequest?: { url: string; method: string; headers?: Record<string, string>; body?: string | null };
  upstream?: unknown;
  transformed?: unknown;
  validation?: Array<{ field_path: string; status: string; value?: unknown }>;
  transformError?: string | null;
  upstreamStatus?: number;
  error?: string;
}

export function TestTab({ appId, endpoint, app }: Props) {
  const [queryOverrides, setQueryOverrides]   = useState<Array<{ k: string; v: string }>>([]);
  const [pathOverrides, setPathOverrides]     = useState<Record<string, string>>({});
  const [requestBody, setRequestBody]         = useState("");
  const [testHeaders, setTestHeaders]         = useState<Array<{ k: string; v: string }>>([]);
  const [running, setRunning]                 = useState(false);
  const [result, setResult]                   = useState<TestResult | null>(null);
  const [error, setError]                     = useState("");
  const [activePanel, setActivePanel]         = useState<"upstream_request" | "upstream_response" | "transformed" | "validation">("transformed");

  const isWriteMethod = ["POST","PUT","PATCH"].includes(endpoint.method);

  // Derive path param names from the path pattern itself.
  // e.g. "/claims/{claimId}" → ["claimId"]
  // This works even when endpoint.path_params[] is empty (not yet configured).
  const derivedParamNames: string[] = (endpoint.path.match(/\{([^}]+)\}/g) ?? [])
    .map(m => m.slice(1, -1));

  // Prefer the configured path_params entries (they may have type/required info),
  // fall back to derived names from the path pattern.
  const configuredParams = endpoint.path_params ?? [];
  const pathParams = derivedParamNames.map(name => {
    const existing = configuredParams.find(p => p.name.toLowerCase() === name.toLowerCase());
    return existing ?? { name, type: "string", required: true };
  });
  const hasPathParams = pathParams.length > 0;

  // ── URL preview helpers ───────────────────────────────────────────────────
  function substituteParams(template: string): string {
    // Step 1: substitute {pathParam} — case-insensitive
    const lowerOverrides: Record<string, string> = {};
    for (const [k, v] of Object.entries(pathOverrides)) lowerOverrides[k.toLowerCase()] = v;

    let result = template.replace(/\{([^}]+)\}/g, (match, name) => {
      const val = pathOverrides[name] ?? lowerOverrides[name.toLowerCase()];
      return val ? val : match; // keep {param} if no value entered yet
    });

    // Step 2: resolve {{ENV_VAR}} for preview (secrets shown as [KEY])
    result = result.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      const envVar = app?.app_env?.find(e => e.key === key);
      if (!envVar) return `{{${key}}}`;
      return envVar.value_type === "secret" ? `[${key}]` : (envVar.plain_value ?? `{{${key}}}`);
    });

    return result;
  }

  const upstreamUrlPreview = substituteParams(endpoint.upstream?.url ?? "");
  const frontendUrlPreview = app
    ? substituteParams(`${app.base_path}${endpoint.path}`)
    : substituteParams(endpoint.path);

  async function run() {
    setRunning(true); setError(""); setResult(null);
    try {
      // Build test_headers object (ignore rows with empty keys)
      const testHeadersObj: Record<string, string> = {};
      testHeaders.forEach(({ k, v }) => { if (k.trim()) testHeadersObj[k.trim()] = v; });

      // Build query_params object for test
      const queryObj: Record<string, string> = {};
      queryOverrides.forEach(({ k, v }) => { if (k) queryObj[k] = v; });

      const body: Record<string, unknown> = {
        path_params:  pathOverrides,
        query_params: queryObj,
        test_headers: testHeadersObj,
      };

      if (isWriteMethod && requestBody.trim()) {
        try { body["request_body"] = JSON.parse(requestBody); }
        catch { body["request_body"] = requestBody; }
      }

      const res = await fetch(`/__config/apps/${appId}/endpoints/${endpoint._id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      const data = await res.json() as TestResult;
      if (!res.ok) { setError((data as any).error ?? `HTTP ${res.status}`); }
      else { setResult(data); }
    } catch (e) { setError(String(e)); }
    finally { setRunning(false); }
  }

  const panels = [
    { key: "upstream_request",  label: "Upstream Request",   data: result?.upstreamRequest },
    { key: "upstream_response", label: "Raw Upstream",        data: result?.upstream },
    { key: "transformed",       label: "Transformed Output",  data: result?.transformed },
    { key: "validation",        label: "Schema Validation",   data: result?.validation },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead title="Test Request" action={<Btn size="sm" onClick={run} disabled={running}>{running ? "Running…" : "▶ Run Test"}</Btn>} />
        <div style={{ padding: 16 }}>

          {/* URL Preview */}
          <div style={{ marginBottom: 16, padding: 12, background: "var(--selection)", borderRadius: C.radius, border: `1px solid var(--border)` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--primary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>Request Preview</div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>What your client calls (via port 5000):</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 12 }}>
                <span style={{ background: C.selection, color: C.primary, padding: "1px 6px", borderRadius: 3, fontWeight: 700, fontSize: 11 }}>{endpoint.method}</span>
                <span style={{ color: C.text }}>localhost:5000{frontendUrlPreview}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>What orchestrator calls upstream:</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 12 }}>
                <span style={{ background: C.selection, color: C.primary, padding: "1px 6px", borderRadius: 3, fontWeight: 700, fontSize: 11 }}>{endpoint.upstream?.method ?? endpoint.method}</span>
                <span style={{ color: C.muted, wordBreak: "break-all" }}>{upstreamUrlPreview || <em>Set upstream URL in the Upstream tab first</em>}</span>
              </div>
            </div>
          </div>

          {/* Path Parameters — named inputs from endpoint.path_params */}
          {hasPathParams && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Path Parameters — fill to resolve the URL above
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pathParams.map(pp => (
                  <div key={pp.name} style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "0 8px", alignItems: "center" }}>
                    <code style={{ fontSize: 13, color: C.primary, fontWeight: 600 }}>{`{${pp.name}}`}</code>
                    <input
                      style={inputStyle}
                      value={pathOverrides[pp.name] ?? ""}
                      onChange={e => setPathOverrides(p => ({ ...p, [pp.name]: e.target.value }))}
                      placeholder={`enter value for ${pp.name}`}
                      autoFocus={pathParams.indexOf(pp) === 0}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Query Params */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Query Param Overrides</span>
              <Btn size="sm" variant="ghost" onClick={() => setQueryOverrides(p => [...p, { k: "", v: "" }])}>+ Add</Btn>
            </div>
            {queryOverrides.length === 0 && <p style={{ fontSize: 12, color: C.muted }}>No overrides — endpoint defaults will be used.</p>}
            {queryOverrides.map((qo, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0 8px", marginBottom: 6 }}>
                <input style={inputStyle} value={qo.k} onChange={e => setQueryOverrides(p => p.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="param name" />
                <input style={inputStyle} value={qo.v} onChange={e => setQueryOverrides(p => p.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="value" />
                <button onClick={() => setQueryOverrides(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }}>×</button>
              </div>
            ))}
          </div>

          {/* Test Headers — ad-hoc, not persisted */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Test Headers</span>
                <span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>added to this test run only — not saved</span>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => setTestHeaders(h => [...h, { k: "", v: "" }])}>+ Add</Btn>
            </div>
            {testHeaders.length === 0 && (
              <p style={{ fontSize: 12, color: C.muted }}>
                Add headers for this run — e.g. <code>Authorization: Bearer &lt;token&gt;</code> or <code>X-Correlation-ID: test-123</code>.
                Static headers from the Upstream tab are always included automatically.
              </p>
            )}
            {testHeaders.map((h, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0 8px", marginBottom: 6 }}>
                <input style={inputStyle} value={h.k} onChange={e => setTestHeaders(p => p.map((x, j) => j === i ? { ...x, k: e.target.value } : x))} placeholder="Header-Name" />
                <input style={inputStyle} value={h.v} onChange={e => setTestHeaders(p => p.map((x, j) => j === i ? { ...x, v: e.target.value } : x))} placeholder="header-value" />
                <button onClick={() => setTestHeaders(p => p.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }}>×</button>
              </div>
            ))}
          </div>

          {/* Request Body */}
          {isWriteMethod && (
            <Field label={`Request Body (${endpoint.request?.content_type ?? "application/json"})`}>
              <textarea value={requestBody} onChange={e => setRequestBody(e.target.value)}
                style={{ ...inputStyle, height: 100, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
                placeholder='{"key": "value"}' />
            </Field>
          )}

          {/* Info: which static headers will be sent */}
          {(endpoint.upstream?.static_headers?.length ?? 0) > 0 && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--selection)", borderRadius: C.radius, fontSize: 12, color: "var(--primary)" }}>
              <strong>Static headers from config (always included):</strong>{" "}
              {endpoint.upstream.static_headers.map(sh => (
                <code key={sh.name} style={{ marginRight: 8 }}>{sh.name}: {sh.value}</code>
              ))}
            </div>
          )}
          {(endpoint.upstream?.forwarded_headers?.length ?? 0) > 0 && (
            <div style={{ marginTop: 6, padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, fontSize: 12, color: "var(--warning)" }}>
              <strong>Header forwarding rules (from real frontend — not applied in test):</strong>{" "}
              {endpoint.upstream.forwarded_headers.map(fh => (
                <code key={fh.from_name} style={{ marginRight: 8 }}>
                  {fh.from_name}{fh.to_name && fh.to_name !== fh.from_name ? ` → ${fh.to_name}` : ""}
                  {fh.required ? " (required)" : ""}
                </code>
              ))}
              <span style={{ display: "block", marginTop: 4 }}>Use "Test Headers" above to simulate these for the test.</span>
            </div>
          )}
        </div>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <SectionHead title={`Results — upstream returned HTTP ${result.upstreamStatus ?? "?"}`} />
          <div style={{ padding: "0 16px 4px 16px", display: "flex", gap: 0, borderBottom: `1px solid ${C.border}` }}>
            {panels.map(panel => (
              <button key={panel.key} onClick={() => setActivePanel(panel.key as any)} style={{
                padding: "8px 12px", background: "none", border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                color: activePanel === panel.key ? C.primary : C.muted,
                borderBottom: activePanel === panel.key ? `2px solid ${C.primary}` : "2px solid transparent",
                marginBottom: -1,
              }}>{panel.label}</button>
            ))}
          </div>
          <div style={{ padding: 16 }}>
            {result.transformError && (
              <div style={{ padding: "8px 12px", background: "var(--danger-background)", borderRadius: C.radius, fontSize: 12, color: C.danger, marginBottom: 12 }}>
                Transform error: {result.transformError}
              </div>
            )}
            {panels.map(panel => panel.key === activePanel && (
              panel.key === "validation"
                ? <ValidationPanel key={panel.key} validation={result.validation} />
                : <pre key={panel.key} style={{ margin: 0, padding: 12, background: "var(--code-bg)", color: "var(--code-text)", borderRadius: C.radius, fontSize: 11, overflowX: "auto", maxHeight: 400 }}>
                    {JSON.stringify(panel.data, null, 2) ?? "No data"}
                  </pre>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ValidationPanel({ validation }: { validation?: TestResult["validation"] }) {
  if (!validation || validation.length === 0) return <p style={{ fontSize: 12, color: C.muted }}>No validation data</p>;

  const statusColor: Record<string, string> = {
    matched: C.success ?? "var(--success)",
    missing: "var(--danger)",
    nullable_absent: "var(--warning)",
    type_mismatch: "var(--warning)",
  };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "var(--surface-muted)" }}>
          {["Field Path", "Status", "Value"].map(h => (
            <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {validation.map((v, i) => (
          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
            <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>{v.field_path}</td>
            <td style={{ padding: "6px 10px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: statusColor[v.status] ?? "var(--muted)" }}>
                {v.status.replace(/_/g, " ").toUpperCase()}
              </span>
            </td>
            <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 11, color: "var(--muted)" }}>
              {v.value !== undefined ? JSON.stringify(v.value) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
