import { useState, useEffect, useRef } from "react";
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

// Full handler (replaces upstream entirely)
export async function handler(ctx) {
  const data = await ctx.fetch(\`\${ctx.env.BASE_URL}/some-path\`);
  return { status: 200, body: await data.json() };
}

// Post-hook: upstream = { status, body, headers }
// export async function postHook(ctx, upstream) {
//   if (upstream.status === 404) return { status: 200, body: { found: false } };
//   if (upstream.status >= 400) return { status: upstream.status, body: upstream.body };
//   return { status: 200, body: upstream.body };
// }
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
  const [addInFolder, setAddInFolder] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ filename: "", language: "javascript" as ScriptLanguage, description: "" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<AppScript | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  const FOLDERS_KEY = `script_folders_${appId}`;
  function loadPersistedFolders(): string[] {
    try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]"); } catch { return []; }
  }
  function persistFolders(folders: string[]) {
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); } catch {}
  }

  const [scriptFolders, setScriptFolders] = useState<string[]>(() => loadPersistedFolders());
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragScriptId, setDragScriptId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");

  function updateScriptFolders(updater: (prev: string[]) => string[]) {
    setScriptFolders(prev => {
      const next = updater(prev);
      persistFolders(next);
      return next;
    });
  }

  function deleteScriptFolder(folder: string) {
    const toMove = scripts.filter(s => s.folder === folder);
    Promise.all(toMove.map(s => api.put(`/__config/apps/${appId}/scripts/${s._id}`, { folder: null })))
      .then(() => {
        setScripts(prev => prev.map(s => s.folder === folder ? { ...s, folder: null } : s));
        updateScriptFolders(prev => prev.filter(f => f !== folder));
        setFolderMenuOpen(null);
      }).catch(() => {});
  }

  function renameScriptFolder(oldName: string, newName: string) {
    if (!newName.trim() || newName === oldName) { setRenamingFolder(null); return; }
    const trimmed = newName.trim();
    const toRename = scripts.filter(s => s.folder === oldName);
    Promise.all(toRename.map(s => api.put(`/__config/apps/${appId}/scripts/${s._id}`, { folder: trimmed })))
      .then(() => {
        setScripts(prev => prev.map(s => s.folder === oldName ? { ...s, folder: trimmed } : s));
        updateScriptFolders(prev => Array.from(new Set(prev.map(f => f === oldName ? trimmed : f))).sort());
        setRenamingFolder(null); setFolderMenuOpen(null);
      }).catch(() => {});
  }

  async function loadScripts() {
    setLoading(true); setError("");
    try {
      const res = await api.get<{ count: number; results: AppScript[] }>(`/__config/apps/${appId}/scripts`);
      setScripts(res.results);
      updateScriptFolders(prev => {
        const fromServer = res.results.map(s => s.folder).filter(Boolean) as string[];
        return Array.from(new Set([...prev, ...fromServer])).sort();
      });
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
      // Preserve folder from selected — the PUT only touches filename/language/source/description
      // The server returns the full doc but we guard here in case it ever comes back without folder
      const withFolder = { ...updated, folder: updated.folder ?? selected.folder ?? null };
      setScripts(prev => prev.map(s => s._id === withFolder._id ? withFolder : s));
      setSelected(withFolder);
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
        ...(addInFolder ? { folder: addInFolder } : {}),
      });
      setScripts(prev => [...prev, created]);
      if (created.folder) updateScriptFolders(prev => Array.from(new Set([...prev, created.folder!])).sort());
      setShowAdd(false);
      setAddInFolder(null);
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
        <div style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.bg, minHeight: 0 }}>
          {/* Header */}
          <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".4px" }}>SCRIPTS ({scripts.length})</span>
              {!readonly && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => { setShowAddFolder(f => !f); setNewFolderName(""); }}
                    title="New folder"
                    style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: C.radius, cursor: "pointer", color: C.muted, fontSize: 11, padding: "2px 6px" }}>
                    📁
                  </button>
                  <button onClick={() => { setShowAdd(true); setAddError(""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.primary, fontSize: 18, lineHeight: 1, padding: "0 2px" }}
                    title="New script file">+</button>
                </div>
              )}
            </div>
            {showAddFolder && !readonly && (
              <div style={{ padding: "0 10px 10px" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const name = newFolderName.trim();
                        if (!name) return;
                        updateScriptFolders(prev => Array.from(new Set([...prev, name])).sort());
                        setCollapsedFolders(f => { const n = new Set(f); n.delete(name); return n; });
                        setShowAddFolder(false); setNewFolderName("");
                      }
                      if (e.key === "Escape") { setShowAddFolder(false); setNewFolderName(""); }
                    }}
                    placeholder="Folder name…"
                    style={{ flex: 1, fontSize: 12, padding: "4px 8px", border: `1px solid ${C.border}`, borderRadius: C.radius }}
                  />
                  <button
                    onClick={() => {
                      const name = newFolderName.trim();
                      if (!name) return;
                      updateScriptFolders(prev => Array.from(new Set([...prev, name])).sort());
                      setCollapsedFolders(f => { const n = new Set(f); n.delete(name); return n; });
                      setShowAddFolder(false); setNewFolderName("");
                    }}
                    style={{ fontSize: 11, padding: "4px 8px", border: `1px solid ${C.primary}`, borderRadius: C.radius, background: C.primary, color: C.primaryText, cursor: "pointer" }}>
                    Add
                  </button>
                </div>
                <p style={{ fontSize: 10, color: C.muted, margin: "4px 0 0" }}>Drag scripts into the folder, or use + to create inside it.</p>
              </div>
            )}
          </div>

          {loading && <div style={{ padding: 16, fontSize: 12, color: C.muted, flexShrink: 0 }}>Loading…</div>}

          {/* Scrollable list */}
          <div
            style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
            onDragOver={e => { e.preventDefault(); setDragOverTarget("__root__"); }}
            onDrop={e => {
              e.preventDefault();
              if (!dragScriptId) return;
              api.put(`/__config/apps/${appId}/scripts/${dragScriptId}`, { folder: null })
                .then(() => setScripts(prev => prev.map(s => s._id === dragScriptId ? { ...s, folder: null } : s)))
                .catch(() => {});
              setDragScriptId(null); setDragOverTarget(null);
            }}
            onDragLeave={() => setDragOverTarget(null)}
          >
            {!loading && scripts.length === 0 && scriptFolders.length === 0 && !showAdd && (
              <div style={{ padding: 16, fontSize: 12, color: C.muted, textAlign: "center" }}>
                No scripts yet.<br />
                {!readonly && <span style={{ color: C.primary, cursor: "pointer" }} onClick={() => setShowAdd(true)}>Create your first script</span>}
              </div>
            )}

            {/* New script form (root or in-folder) */}
            {showAdd && (
              <div style={{ padding: 12, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                {addInFolder && <div style={{ fontSize: 10, color: C.primary, marginBottom: 6, fontWeight: 600 }}>📁 {addInFolder}</div>}
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
                  <Btn size="sm" variant="ghost" onClick={() => { setShowAdd(false); setAddInFolder(null); }}>Cancel</Btn>
                </div>
              </div>
            )}

            {(() => {
              const rootScripts = scripts.filter(s => !s.folder);

              const langBadge = (s: AppScript) => (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: s.language === "typescript" ? C.selection : C.warningBg, color: s.language === "typescript" ? C.primary : C.warning, fontFamily: "monospace", flexShrink: 0 }}>
                  {s.language === "typescript" ? "TS" : "JS"}
                </span>
              );

              return (
                <>
                  {/* Folders (from state — allows empty folders) */}
                  {scriptFolders.map(folder => {
                    const folderScripts = scripts.filter(s => s.folder === folder);
                    const isCollapsed = collapsedFolders.has(folder);
                    const isOver = dragOverTarget === folder;
                    const isMenuOpen = folderMenuOpen === folder;
                    const isRenaming = renamingFolder === folder;
                    return (
                      <div key={folder}>
                        <div
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverTarget(folder); }}
                          onDrop={e => {
                            e.preventDefault(); e.stopPropagation();
                            if (!dragScriptId) return;
                            api.put(`/__config/apps/${appId}/scripts/${dragScriptId}`, { folder })
                              .then(() => setScripts(prev => prev.map(s => s._id === dragScriptId ? { ...s, folder } : s)))
                              .catch(() => {});
                            setDragScriptId(null); setDragOverTarget(null);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "7px 8px 7px 10px", cursor: "pointer",
                            borderBottom: `1px solid ${C.border}`,
                            background: isOver ? C.selection : C.bg,
                            outline: isOver ? `1px dashed ${C.primary}` : undefined,
                          }}>
                          <span
                            onClick={() => setCollapsedFolders(f => { const n = new Set(f); isCollapsed ? n.delete(folder) : n.add(folder); return n; })}
                            style={{ fontSize: 10, color: C.muted, userSelect: "none", flexShrink: 0 }}>
                            {isCollapsed ? "▶" : "▼"}
                          </span>
                          <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameFolderValue}
                              onChange={e => setRenameFolderValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") renameScriptFolder(folder, renameFolderValue);
                                if (e.key === "Escape") { setRenamingFolder(null); setFolderMenuOpen(null); }
                              }}
                              onBlur={() => renameScriptFolder(folder, renameFolderValue)}
                              onClick={e => e.stopPropagation()}
                              style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: "1px 4px", border: `1px solid ${C.primary}`, borderRadius: 3 }}
                            />
                          ) : (
                            <span
                              onClick={() => setCollapsedFolders(f => { const n = new Set(f); isCollapsed ? n.delete(folder) : n.add(folder); return n; })}
                              style={{ fontSize: 12, fontWeight: 600, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {folder}
                            </span>
                          )}
                          <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>{folderScripts.length}</span>
                          {!readonly && !isRenaming && (
                            <>
                              <button
                                title={`Add script in ${folder}`}
                                onClick={e => { e.stopPropagation(); setAddInFolder(folder); setShowAdd(true); setAddError(""); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: C.primary, fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>
                                +
                              </button>
                              <button
                                title="Folder options"
                                onClick={e => { e.stopPropagation(); setFolderMenuOpen(isMenuOpen ? null : folder); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>
                                ⋯
                              </button>
                            </>
                          )}
                        </div>
                        {/* Folder context menu */}
                        {isMenuOpen && (
                          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, margin: "0 8px 4px", boxShadow: C.shadow, overflow: "hidden" }}>
                            <button
                              onClick={e => { e.stopPropagation(); setRenamingFolder(folder); setRenameFolderValue(folder); setFolderMenuOpen(null); }}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${C.border}` }}
                              onMouseEnter={el => (el.currentTarget.style.background = C.bg)}
                              onMouseLeave={el => (el.currentTarget.style.background = "none")}>
                              ✏️ Rename folder
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); deleteScriptFolder(folder); }}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.danger }}
                              onMouseEnter={el => (el.currentTarget.style.background = "var(--danger-background)")}
                              onMouseLeave={el => (el.currentTarget.style.background = "none")}>
                              🗑 Delete folder{folderScripts.length > 0 ? ` (moves ${folderScripts.length} script${folderScripts.length > 1 ? "s" : ""} to root)` : ""}
                            </button>
                          </div>
                        )}
                        
                        {!isCollapsed && folderScripts.map(s => (
                          <div key={s._id}
                            draggable
                            onDragStart={() => setDragScriptId(s._id)}
                            onDragEnd={() => { setDragScriptId(null); setDragOverTarget(null); }}
                            onClick={() => selectScript(s)}
                            style={{
                              padding: "8px 10px 8px 26px", cursor: "pointer",
                              borderBottom: `1px solid ${C.border}`,
                              background: selected?._id === s._id ? C.selection : dragScriptId === s._id ? "var(--surface-muted)" : "transparent",
                              display: "flex", alignItems: "center", gap: 8,
                            }}>
                            {langBadge(s)}
                            <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text, fontFamily: "monospace" }}>{s.filename}</span>
                            {!readonly && <button onClick={e => { e.stopPropagation(); setDeleteTarget(s); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: "0 2px", flexShrink: 0 }}>×</button>}
                          </div>
                        ))}
                        {!isCollapsed && folderScripts.length === 0 && (
                          <div style={{ padding: "8px 10px 8px 26px", fontSize: 11, color: C.muted, fontStyle: "italic", borderBottom: `1px solid ${C.border}` }}>
                            Drag scripts here or use +
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Root scripts */}
                  {rootScripts.map(s => (
                    <div key={s._id}
                      draggable
                      onDragStart={() => setDragScriptId(s._id)}
                      onDragEnd={() => { setDragScriptId(null); setDragOverTarget(null); }}
                      onClick={() => selectScript(s)}
                      style={{
                        padding: "9px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}`,
                        background: selected?._id === s._id ? C.selection : dragScriptId === s._id ? "var(--surface-muted)" : "transparent",
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                      {langBadge(s)}
                      <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text, fontFamily: "monospace" }}>{s.filename}</span>
                      {!readonly && <button onClick={e => { e.stopPropagation(); setDeleteTarget(s); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, padding: "0 2px", flexShrink: 0 }}>×</button>}
                    </div>
                  ))}
                </>
              );
            })()}
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
                theme="orchestrator-navy"
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
    <div style={{ borderBottom: `1px solid ${C.border}`, background: "var(--code-bg)", flexShrink: 0 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--code-text)", fontSize: 11, padding: "5px 14px", width: "100%", textAlign: "left" }}>
        {open ? "▾" : "▸"} ctx reference
      </button>
      {open && (
        <pre style={{ margin: 0, padding: "0 14px 10px", fontSize: 11, color: "var(--code-text)", lineHeight: 1.6, overflowX: "auto" }}>{`ctx.request       — validated request body (typed by input schema)
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
export async function postHook(ctx, upstream) {
  // upstream = { status: number, body: unknown, headers: Record<string,string> }
  // upstream.status is the HTTP status from the upstream service
  if (upstream.status >= 400) {
    // handle or remap upstream errors — return your own response:
    // return { status: 200, body: { found: false } };
    // or pass the error through as-is:
    return { status: upstream.status, body: upstream.body };
  }
  return { status: 200, body: upstream.body };
}`}</pre>
      )}
    </div>
  );
}
