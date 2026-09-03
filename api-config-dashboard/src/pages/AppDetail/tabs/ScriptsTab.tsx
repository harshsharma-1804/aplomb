import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { api } from "../../../api/client";
import type { AppScript, ScriptLanguage } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C, Confirm } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props { appId: string; }

const STARTER: Record<ScriptLanguage, string> = {
  javascript: `// Available: handler (full), preHook (pre), postHook (post)
// ctx.request, ctx.params, ctx.query, ctx.principal, ctx.env
// ctx.fetch(url, options)  — allowlist-enforced
// ctx.call(appBasePath, endpointPath, options) — internal endpoint call
// ctx.logger.info / .warn / .error

export async function handler(ctx) {
  const data = await ctx.fetch(\`\${ctx.env.BASE_URL}/some-path\`);
  return { status: 200, body: await data.json() };
}
`,
  typescript: `// Available: handler (full), preHook (pre), postHook (post)

interface Ctx {
  request: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
  principal: { sub: string; email: string | null; roles: string[] } | null;
  env: Record<string, string>;
  fetch: typeof fetch;
  call: (appBasePath: string, endpointPath: string, options?: { method?: string; body?: unknown; query?: Record<string, string> }) => Promise<unknown>;
  logger: { info(msg: string, data?: object): void; warn(msg: string, data?: object): void; error(msg: string, data?: object): void };
}

interface HandlerResponse { status?: number; body: unknown; headers?: Record<string, string>; }

export async function handler(ctx: Ctx): Promise<HandlerResponse> {
  return { status: 200, body: { message: "hello from script" } };
}
`,
};

export function ScriptsTab({ appId }: Props) {
  const { can } = useSession();
  const readonly = !can("edit:endpoints");

  const [scripts, setScripts] = useState<AppScript[]>([]);
  const [selected, setSelected] = useState<AppScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filename, setFilename] = useState("");
  const [language, setLanguage] = useState<ScriptLanguage>("javascript");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ filename: "", language: "javascript" as ScriptLanguage, description: "" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<AppScript | null>(null);

  async function loadScripts() {
    setLoading(true); setError("");
    try {
      const res = await api.get<{ count: number; results: AppScript[] }>(`/__config/apps/${appId}/scripts`);
      setScripts(res.results);
      if (res.results.length > 0 && !selected) selectScript(res.results[0]!);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadScripts(); }, [appId]);

  function selectScript(s: AppScript) {
    setSelected(s);
    setFilename(s.filename);
    setLanguage(s.language);
    setSource(s.source ?? "");
    setDescription(s.description ?? "");
    setSaveOk(false);
    setSaveError("");
  }

  async function save() {
    if (!selected) return;
    setSaving(true); setSaveError(""); setSaveOk(false);
    try {
      const updated = await api.put<AppScript>(`/__config/apps/${appId}/scripts/${selected._id}`, {
        filename, language, source, description,
      });
      setScripts(prev => prev.map(s => s._id === updated._id ? updated : s));
      setSelected(updated);
      setSaveOk(true);
    } catch (e) { setSaveError(String(e)); }
    finally { setSaving(false); }
  }

  async function addScript() {
    if (!addForm.filename.trim()) { setAddError("Filename is required"); return; }
    setAdding(true); setAddError("");
    try {
      const ext = addForm.language === "typescript" ? ".ts" : ".js";
      const fname = addForm.filename.endsWith(".ts") || addForm.filename.endsWith(".js")
        ? addForm.filename
        : addForm.filename + ext;
      const created = await api.post<AppScript>(`/__config/apps/${appId}/scripts`, {
        filename: fname,
        language: addForm.language,
        description: addForm.description,
        source: STARTER[addForm.language],
      });
      setScripts(prev => [...prev, created]);
      setShowAdd(false);
      setAddForm({ filename: "", language: "javascript", description: "" });
      selectScript(created);
    } catch (e) { setAddError(String(e)); }
    finally { setAdding(false); }
  }

  async function deleteScript(s: AppScript) {
    try {
      await api.del(`/__config/apps/${appId}/scripts/${s._id}`);
      const next = scripts.filter(x => x._id !== s._id);
      setScripts(next);
      setDeleteTarget(null);
      if (selected?._id === s._id) {
        if (next.length > 0) selectScript(next[0]!);
        else { setSelected(null); setSource(""); setFilename(""); }
      }
    } catch (e) { alert(String(e)); }
  }

  const monacoLang = language === "typescript" ? "typescript" : "javascript";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      {error && <ErrorBanner message={error} />}

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 0, flex: 1, minHeight: 0 }}>

        {/* ── File sidebar ─────────────────────────────────────────────── */}
        <div style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.bg }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".4px" }}>SCRIPTS ({scripts.length})</span>
            {!readonly && (
              <button onClick={() => { setShowAdd(true); setAddError(""); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.primary, fontSize: 18, lineHeight: 1, padding: "0 2px" }}
                title="New script file">+</button>
            )}
          </div>

          {loading && <div style={{ padding: 16, fontSize: 12, color: C.muted }}>Loading…</div>}

          {!loading && scripts.length === 0 && !showAdd && (
            <div style={{ padding: 16, fontSize: 12, color: C.muted, textAlign: "center" }}>
              No scripts yet.<br />
              {!readonly && <span style={{ color: C.primary, cursor: "pointer" }} onClick={() => setShowAdd(true)}>Create your first script</span>}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {showAdd && (
              <div style={{ padding: 12, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                {addError && <div style={{ fontSize: 11, color: C.danger, marginBottom: 6 }}>{addError}</div>}
                <input
                  style={{ ...inputStyle, fontSize: 12, marginBottom: 6 }}
                  placeholder="filename (e.g. enrichClaim)"
                  value={addForm.filename}
                  onChange={e => setAddForm(f => ({ ...f, filename: e.target.value }))}
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && addScript()}
                />
                <select style={{ ...inputStyle, fontSize: 12, marginBottom: 8 }} value={addForm.language} onChange={e => setAddForm(f => ({ ...f, language: e.target.value as ScriptLanguage }))}>
                  <option value="javascript">JavaScript (.js)</option>
                  <option value="typescript">TypeScript (.ts)</option>
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn size="sm" onClick={addScript} disabled={adding}>{adding ? "Creating…" : "Create"}</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Btn>
                </div>
              </div>
            )}

            {scripts.map(s => (
              <div key={s._id}
                onClick={() => selectScript(s)}
                style={{
                  padding: "9px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                  background: selected?._id === s._id ? C.primary + "12" : "transparent",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: s.language === "typescript" ? "#3178c620" : "#f7df1e20", color: s.language === "typescript" ? "#3178c6" : "#b5a000", fontFamily: "monospace" }}>
                  {s.language === "typescript" ? "TS" : "JS"}
                </span>
                <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text, fontFamily: "monospace" }}>
                  {s.filename}
                </span>
                {!readonly && (
                  <button onClick={e => { e.stopPropagation(); setDeleteTarget(s); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: "0 2px", flexShrink: 0 }}
                    title="Delete script">×</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Editor panel ─────────────────────────────────────────────── */}
        {!selected ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>
            Select or create a script file to start editing.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>

            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
              <input
                style={{ ...inputStyle, width: 200, fontSize: 12, fontFamily: "monospace" }}
                value={filename}
                onChange={e => { setFilename(e.target.value); setSaveOk(false); }}
                disabled={readonly}
                placeholder="filename.js"
              />
              <select style={{ ...inputStyle, width: 160, fontSize: 12 }} value={language} onChange={e => { setLanguage(e.target.value as ScriptLanguage); setSaveOk(false); }} disabled={readonly}>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
              </select>
              <input
                style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                value={description}
                onChange={e => { setDescription(e.target.value); setSaveOk(false); }}
                disabled={readonly}
                placeholder="Description (optional)"
              />
              {!readonly && (
                <>
                  <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
                  {saveOk && <span style={{ fontSize: 12, color: C.success }}>✓ Saved</span>}
                  {saveError && <span style={{ fontSize: 12, color: C.danger }}>{saveError}</span>}
                </>
              )}
            </div>

            {/* Context reference banner */}
            <ContextRef />

            {/* Monaco editor */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Editor
                height="100%"
                language={monacoLang}
                value={source}
                onChange={v => { setSource(v ?? ""); setSaveOk(false); }}
                options={{
                  readOnly: readonly,
                  fontSize: 13,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on",
                  lineNumbers: "on",
                  renderLineHighlight: "line",
                  automaticLayout: true,
                  padding: { top: 12 },
                }}
                theme="vs-dark"
              />
            </div>
          </div>
        )}
      </div>

      {deleteTarget && (
        <Confirm
          danger
          message={`Delete "${deleteTarget.filename}"? Any endpoints using this script will lose their script assignment.`}
          onConfirm={() => deleteScript(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function ContextRef() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${C.border}`, background: "#1e1e1e", flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9cdcfe", fontSize: 11, padding: "5px 14px", width: "100%", textAlign: "left" }}>
        {open ? "▾" : "▸"} ctx reference
      </button>
      {open && (
        <pre style={{ margin: 0, padding: "0 14px 10px", fontSize: 11, color: "#9cdcfe", lineHeight: 1.6, overflowX: "auto" }}>{`ctx.request       — validated request body (typed by input schema)
ctx.params        — path params  { claimId: "CLM-001" }
ctx.query         — query params { status: "active" }
ctx.principal     — OIDC claims: sub, email, roles, issuer
ctx.env           — app env vars { BASE_URL, ORG_ID, ... }
ctx.fetch(url, init)                     — allowlist-enforced fetch
ctx.call(appBase, path, { method, body, query })  — internal endpoint call
ctx.logger.info(msg, data?)
ctx.logger.warn(msg, data?)
ctx.logger.error(msg, data?)

— Full handler (script_full mode) —
export async function handler(ctx) { return { status: 200, body: { ... } }; }

— Pre-hook (script_pre / script_pre_post) —
export async function preHook(ctx) { /* return response to short-circuit, or void */ }

— Post-hook (script_post / script_pre_post) —
export async function postHook(ctx, upstream) { return { status: 200, body: upstream }; }`}</pre>
      )}
    </div>
  );
}
