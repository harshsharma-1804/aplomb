import { useState } from "react";
import { api } from "../../../api/client";
import type { App, Endpoint, QueryParam, PathParam, StaticHeader, ForwardedHeader } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props { appId: string; endpoint: Endpoint; app: App | null; onSaved: (ep: Endpoint) => void; }

export function UpstreamTab({ appId, endpoint, app, onSaved }: Props) {
  const { can } = useSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [url, setUrl] = useState(endpoint.upstream?.url ?? "");
  const [method, setMethod] = useState(endpoint.upstream?.method ?? endpoint.method);
  const [authType, setAuthType] = useState(endpoint.upstream?.auth_type ?? "forward_cookie");
  const [forwardCookies, setForwardCookies] = useState(endpoint.upstream?.forward_cookies ?? true);
  const [bodyContentType, setBodyContentType] = useState(endpoint.upstream?.body_content_type ?? "application/json");
  const [bodyPassthrough, setBodyPassthrough] = useState(endpoint.upstream?.body_passthrough ?? false);
  const [nestedEncoding, setNestedEncoding] = useState(endpoint.upstream?.form_encoding?.nested ?? "bracket");
  const [arrayEncoding, setArrayEncoding] = useState(endpoint.upstream?.form_encoding?.array ?? "repeat");
  const [boolEncoding, setBoolEncoding] = useState(endpoint.upstream?.form_encoding?.boolean ?? "true_false");
  const [nullEncoding, setNullEncoding] = useState(endpoint.upstream?.form_encoding?.null ?? "omit");
  const [queryParams, setQueryParams] = useState<QueryParam[]>(endpoint.query_params ?? []);
  const [pathParams, setPathParams] = useState<PathParam[]>(endpoint.path_params ?? []);
  const [staticHeaders, setStaticHeaders] = useState<StaticHeader[]>(endpoint.upstream?.static_headers ?? []);
  const [forwardedHeaders, setForwardedHeaders] = useState<ForwardedHeader[]>(endpoint.upstream?.forwarded_headers ?? []);
  const [forwardAllHeaders, setForwardAllHeaders] = useState<boolean>(endpoint.upstream?.forward_all_headers ?? false);

  const isWriteMethod = ["POST","PUT","PATCH"].includes(endpoint.method);
  const showFormEncoding = bodyContentType === "application/x-www-form-urlencoded";

  async function save() {
    setSaving(true); setError("");
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`, {
        upstream: { url, method, forward_cookies: forwardCookies, auth_type: authType, auth_config: endpoint.upstream?.auth_config ?? {}, body_content_type: bodyContentType, body_passthrough: bodyPassthrough, form_encoding: { nested: nestedEncoding, array: arrayEncoding, boolean: boolEncoding, null: nullEncoding }, body_mappings: endpoint.upstream?.body_mappings ?? [], static_headers: staticHeaders, forwarded_headers: forwardedHeaders.map(fh => ({ from_name: fh.from_name.trim(), to_name: fh.to_name.trim(), required: fh.required })), forward_all_headers: forwardAllHeaders },
        query_params: queryParams,
        path_params: pathParams,
      });
      onSaved(ep);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  function addQueryParam() { setQueryParams(p => [...p, { frontend_param: "", upstream_param: "", pass_through: true }]); }
  function removeQueryParam(i: number) { setQueryParams(p => p.filter((_, idx) => idx !== i)); }
  function updateQueryParam(i: number, k: keyof QueryParam, v: string | boolean) { setQueryParams(p => p.map((row, idx) => idx === i ? { ...row, [k]: v } : row)); }

  function addPathParam() { setPathParams(p => [...p, { name: "", type: "string", required: true }]); }
  function removePathParam(i: number) { setPathParams(p => p.filter((_, idx) => idx !== i)); }
  function updatePathParam(i: number, k: keyof PathParam, v: string | boolean) { setPathParams(p => p.map((row, idx) => idx === i ? { ...row, [k]: v } : row)); }

  const readonly = !can("edit:endpoints");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead title="Upstream Connection" action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn> : undefined} />
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "0 12px" }}>
            <Field label="Upstream URL" hint={app?.app_env?.length ? 'Use {{KEY}} to reference app environment variables' : undefined}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input id="upstream-url-input" style={{ ...inputStyle, flex: 1 }} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/claims or {{BASE_URL}}/claims" disabled={readonly} />
                {!readonly && app?.app_env?.length ? <EnvPicker envVars={app.app_env} onSelect={key => setUrl(v => v + `{{${key}}}`)} /> : null}
              </div>
            </Field>
            <Field label="Method">
              <select style={inputStyle} value={method} onChange={e => setMethod(e.target.value)} disabled={readonly}>
                {["GET","POST","PUT","DELETE","PATCH"].map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
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
            <div style={{ padding: 12, background: "#fff8e1", borderRadius: C.radius, border: "1px solid #ffe082", fontSize: 12, color: "#5d4037", marginBottom: 12 }}>
              API key and Bearer token values are stored as Secrets and referenced by ID. Go to <strong>Admin → Secrets</strong> to create or rotate values.
            </div>
          )}
        </div>
      </Card>

      {isWriteMethod && (
        <Card>
          <SectionHead title="Request Body (Outbound)" />
          <div style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 12px" }}>
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

      <Card>
        <SectionHead title="Path Parameters" action={!readonly ? <Btn size="sm" variant="ghost" onClick={addPathParam}>+ Add</Btn> : undefined} />
        <div style={{ padding: 16 }}>
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
              {!readonly && <button onClick={() => removePathParam(i)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }}>×</button>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHead title="Query Params Forwarding" action={!readonly ? <Btn size="sm" variant="ghost" onClick={addQueryParam}>+ Add</Btn> : undefined} />
        <div style={{ padding: 16 }}>
          {queryParams.length === 0 && <p style={{ fontSize: 12, color: C.muted }}>No query param rules yet.</p>}
          {queryParams.map((qp, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto auto", gap: "0 8px", marginBottom: 8, alignItems: "center" }}>
              <input style={inputStyle} value={qp.frontend_param} onChange={e => updateQueryParam(i, "frontend_param", e.target.value)} placeholder="frontend param" disabled={readonly} />
              <input style={inputStyle} value={qp.upstream_param} onChange={e => updateQueryParam(i, "upstream_param", e.target.value)} placeholder="upstream param" disabled={readonly} />
              <label style={{ display: "flex", gap: 4, fontSize: 12, alignItems: "center" }}>
                <input type="checkbox" checked={qp.pass_through} onChange={e => updateQueryParam(i, "pass_through", e.target.checked)} disabled={readonly} />pass
              </label>
              <input style={{ ...inputStyle, width: 80 }} value={qp.default_value ?? ""} onChange={e => updateQueryParam(i, "default_value", e.target.value)} placeholder="default" disabled={readonly} />
              {!readonly && <button onClick={() => removeQueryParam(i)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger }}>×</button>}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Static Headers ─────────────────────────────────────────────── */}
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
              <input
                style={inputStyle}
                value={sh.name}
                onChange={e => setStaticHeaders(h => h.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                placeholder="Header-Name"
                disabled={readonly}
              />
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={sh.value}
                  onChange={e => setStaticHeaders(h => h.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  placeholder="value or {{ENV_KEY}}"
                  disabled={readonly}
                />
                {!readonly && app?.app_env?.length ? <EnvPicker envVars={app.app_env} onSelect={key => setStaticHeaders(h => h.map((x, j) => j === i ? { ...x, value: x.value + `{{${key}}}` } : x))} /> : null}
              </div>
              {!readonly && (
                <button onClick={() => setStaticHeaders(h => h.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }}>×</button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Header Forwarding Rules ─────────────────────────────────────── */}
      <Card>
        <SectionHead
          title="Header Forwarding Rules"
          action={!readonly ? <Btn size="sm" variant="ghost" onClick={() => setForwardedHeaders(h => [...h, { from_name: "", to_name: "", required: false }])}>+ Add</Btn> : undefined}
        />
        <div style={{ padding: 16 }}>
          {/* Forward-all toggle */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: C.radius, border: `1px solid ${forwardAllHeaders ? C.primary : C.border}`, background: forwardAllHeaders ? C.primary + "08" : C.surface, marginBottom: 12, cursor: readonly ? "default" : "pointer" }}>
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
              : "Forward specific headers from the frontend request to the upstream. Optionally rename them. Use for correlation IDs, tenant headers, locale, or custom auth tokens."}
          </p>
          {forwardedHeaders.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: "0 8px", marginBottom: 6, padding: "0 0 4px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>FRONTEND SENDS</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>UPSTREAM RECEIVES</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>REQUIRED</span>
              <span />
            </div>
          )}
          {forwardedHeaders.map((fh, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: "0 8px", marginBottom: 8, alignItems: "center" }}>
              <input
                style={inputStyle}
                value={fh.from_name}
                onChange={e => setForwardedHeaders(h => h.map((x, j) => j === i ? { ...x, from_name: e.target.value } : x))}
                placeholder="X-Correlation-ID"
                disabled={readonly}
              />
              <input
                style={{ ...inputStyle, borderColor: fh.to_name && fh.to_name !== fh.from_name ? "#fd7e14" : C.border }}
                value={fh.to_name}
                onChange={e => setForwardedHeaders(h => h.map((x, j) => j === i ? { ...x, to_name: e.target.value } : x))}
                placeholder={fh.from_name || "same name if blank"}
                disabled={readonly}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={fh.required}
                  onChange={e => setForwardedHeaders(h => h.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                  disabled={readonly}
                />
                <span style={{ color: fh.required ? C.danger : C.muted }}>required</span>
              </label>
              {!readonly && (
                <button onClick={() => setForwardedHeaders(h => h.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }}>×</button>
              )}
            </div>
          ))}
          {forwardedHeaders.length === 0 && (
            <p style={{ fontSize: 12, color: C.muted }}>No forwarding rules. Auth headers are handled by the auth type setting above.</p>
          )}
          {forwardedHeaders.some(fh => fh.required) && (
            <div style={{ marginTop: 8, padding: "6px 10px", background: "#fff5f5", borderRadius: C.radius, fontSize: 12, color: C.danger }}>
              Required headers: if the frontend does not send them, the orchestrator returns <code>400 REQUIRED_HEADER_MISSING</code>.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
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
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, boxShadow: "0 4px 12px rgba(0,0,0,0.12)", zIndex: 100, minWidth: 200, maxHeight: 200, overflowY: "auto" }}>
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


