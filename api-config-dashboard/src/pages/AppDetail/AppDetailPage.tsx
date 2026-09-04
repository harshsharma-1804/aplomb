import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { App, Endpoint, ListResult } from "../../api/types";
import { Btn, Badge, Spinner, ErrorBanner, Confirm, MethodBadge, C, Modal, Field, inputStyle } from "../../components";
import { useSession } from "../../auth/SessionContext";
import { RequestSchemaTab } from "./tabs/RequestSchemaTab";
import { ResponseSchemaTab } from "./tabs/ResponseSchemaTab";
import { UpstreamTab } from "./tabs/UpstreamTab";
import { SampleTab } from "./tabs/SampleTab";
import { MappingTab } from "./tabs/MappingTab";
import { TestTab } from "./tabs/TestTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ScriptsTab } from "./tabs/ScriptsTab";

const TABS = [
  { key: "request-schema",  label: "Request Schema" },
  { key: "response-schema", label: "Response Schema" },
  { key: "upstream",        label: "Upstream" },
  { key: "sample",          label: "Sample" },
  { key: "mapping",         label: "Field Mapping" },
  { key: "test",            label: "Test" },
];

export function AppDetailPage() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { can } = useSession();

  const [app, setApp] = useState<App | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [activeTab, setActiveTab] = useState("response-schema");
  const [topTab, setTopTab] = useState<"endpoints" | "scripts" | "settings">("endpoints");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddEndpoint, setShowAddEndpoint] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState<Endpoint | null>(null);
  const [deleteEndpoint, setDeleteEndpoint] = useState<Endpoint | null>(null);
  const [showCloneApp, setShowCloneApp] = useState(false);
  const [endpointSettingsOpen, setEndpointSettingsOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragEndpointId, setDragEndpointId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  async function load() {
    if (!appId) return;
    setLoading(true); setError("");
    try {
      const [a, e] = await Promise.all([
        api.get<App>(`/__config/apps/${appId}`),
        api.get<ListResult<Endpoint>>(`/__config/apps/${appId}/endpoints`),
      ]);
      setApp(a);
      setEndpoints(e.results);
      if (e.results.length > 0 && !selectedEndpoint) setSelectedEndpoint(e.results[0]!);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [appId]);
  useEffect(() => { setEndpointSettingsOpen(false); }, [selectedEndpoint?._id]);

  async function handleDeleteEndpoint(ep: Endpoint) {
    try {
      await api.del(`/__config/apps/${appId}/endpoints/${ep._id}`);
      setDeleteEndpoint(null);
      if (selectedEndpoint?._id === ep._id) setSelectedEndpoint(null);
      load();
    } catch (e) { alert(String(e)); }
  }

  async function handleToggleActive(ep: Endpoint) {
    try {
      const updated = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${ep._id}`, { is_active: !ep.is_active });
      setEndpoints(prev => prev.map(e => e._id === updated._id ? updated : e));
      if (selectedEndpoint?._id === updated._id) setSelectedEndpoint(updated);
    } catch (e) { alert(String(e)); }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!app) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── App header ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <button onClick={() => navigate("/apps")} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 13, padding: 0 }}>← Apps</button>
            <span style={{ color: C.border }}>|</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{app.name}</h1>
            <Badge text={app.status} />
            {app.mode && <ModeBadge mode={app.mode} />}
            {app.auth_required === false && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "#fff8e1", color: "#92400e", border: "1px solid #fcd34d" }}>
                🔓 AUTH OFF
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontSize: 12, color: C.muted, background: C.bg, padding: "2px 8px", borderRadius: 3 }}>{app.base_path}</code>
            <span style={{ fontSize: 11, color: C.muted }}>→ frontend calls this prefix + endpoint path</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {can("manage:apps") && <Btn size="sm" variant="ghost" onClick={() => navigate(`/apps/${appId}/history`)}>History</Btn>}
          {can("manage:apps") && <Btn size="sm" variant="outline" onClick={() => navigate(`/apps/${appId}/compare`)}>Compare</Btn>}
        </div>
      </div>

      {/* ── Top-level tabs: Endpoints | Settings ───────────────────────── */}
      <div style={{ display: "flex", borderBottom: `2px solid ${C.border}`, marginBottom: 16, flexShrink: 0 }}>
        {([{ key: "endpoints", label: "Endpoints" }, { key: "scripts", label: "Scripts" }, { key: "settings", label: "⚙ Settings" }] as const).map(t => (
          <button key={t.key} onClick={() => setTopTab(t.key)} style={{
            padding: "8px 16px", background: "none", border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 600,
            color: topTab === t.key ? C.primary : C.muted,
            borderBottom: topTab === t.key ? `2px solid ${C.primary}` : "2px solid transparent",
            marginBottom: -2,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Scripts tab ────────────────────────────────────────────────── */}
      {topTab === "scripts" && (
        <div style={{ flex: 1, minHeight: 0, border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden", background: C.surface }}>
          <ScriptsTab appId={appId!} />
        </div>
      )}

      {/* ── Settings tab ───────────────────────────────────────────────── */}
      {topTab === "settings" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <SettingsTab
            app={app}
            appId={appId!}
            onAppUpdated={updated => setApp(updated)}
            onDeleteApp={async () => {
              await api.del(`/__config/apps/${appId}`);
              navigate("/apps");
            }}
            onCloneApp={() => setShowCloneApp(true)}
          />
        </div>
      )}

      {/* ── Endpoints two-column layout ────────────────────────────────── */}
      {topTab === "endpoints" && <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "stretch", flex: 1, minHeight: 0 }}>

        {/* ── Endpoint sidebar ─────────────────────────────────────────── */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Header */}
          <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`, background: C.bg }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>ENDPOINTS ({endpoints.length})</span>
              {can("edit:endpoints") && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => { setShowAddFolder(f => !f); setNewFolderName(""); }}
                    title="New folder"
                    style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: C.radius, cursor: "pointer", color: C.muted, fontSize: 12, padding: "2px 7px", lineHeight: 1.4 }}>
                    📁
                  </button>
                  <Btn size="sm" onClick={() => setShowAddEndpoint(true)}>+</Btn>
                </div>
              )}
            </div>
            {showAddFolder && (
              <div style={{ padding: "0 10px 10px" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && newFolderName.trim()) {
                        const name = newFolderName.trim();
                        const firstUnassigned = endpoints.find(ep => !ep.folder);
                        if (firstUnassigned) {
                          api.put(`/__config/apps/${appId}/endpoints/${firstUnassigned._id}`, { folder: name })
                            .then(() => load()).catch(() => {});
                        }
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
                      setEndpoints(prev => {
                        const hasFolder = prev.some(ep => ep.folder === name);
                        if (hasFolder) return prev;
                        return prev;
                      });
                      setCollapsedFolders(f => { const n = new Set(f); n.delete(name); return n; });
                      setShowAddFolder(false); setNewFolderName("");
                    }}
                    style={{ fontSize: 11, padding: "4px 8px", border: `1px solid ${C.primary}`, borderRadius: C.radius, background: C.primary, color: "#fff", cursor: "pointer" }}>
                    Add
                  </button>
                </div>
                <p style={{ fontSize: 10, color: C.muted, margin: "4px 0 0" }}>Drag endpoints into the folder to populate it.</p>
              </div>
            )}
          </div>

          {/* Scrollable list */}
          <div
            style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
            onDragOver={e => { e.preventDefault(); setDragOverTarget("__root__"); }}
            onDrop={e => {
              e.preventDefault();
              if (!dragEndpointId) return;
              api.put(`/__config/apps/${appId}/endpoints/${dragEndpointId}`, { folder: null })
                .then(() => {
                  setEndpoints(prev => prev.map(ep => ep._id === dragEndpointId ? { ...ep, folder: null } : ep));
                }).catch(() => {});
              setDragEndpointId(null); setDragOverTarget(null);
            }}
            onDragLeave={() => setDragOverTarget(null)}
          >
            {endpoints.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: C.muted, textAlign: "center" }}>No endpoints yet</div>
            ) : (() => {
              const folders = Array.from(new Set(endpoints.map(ep => ep.folder).filter(Boolean) as string[])).sort();
              const rootEndpoints = endpoints.filter(ep => !ep.folder);

              return (
                <>
                  {/* Folders */}
                  {folders.map(folder => {
                    const folderEps = endpoints.filter(ep => ep.folder === folder);
                    const isCollapsed = collapsedFolders.has(folder);
                    const isOver = dragOverTarget === folder;
                    return (
                      <div key={folder}>
                        {/* Folder row */}
                        <div
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverTarget(folder); }}
                          onDrop={e => {
                            e.preventDefault(); e.stopPropagation();
                            if (!dragEndpointId) return;
                            api.put(`/__config/apps/${appId}/endpoints/${dragEndpointId}`, { folder })
                              .then(() => {
                                setEndpoints(prev => prev.map(ep => ep._id === dragEndpointId ? { ...ep, folder } : ep));
                              }).catch(() => {});
                            setDragEndpointId(null); setDragOverTarget(null);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "7px 10px", cursor: "pointer",
                            borderBottom: `1px solid ${C.border}`,
                            background: isOver ? C.primary + "18" : C.bg,
                            border: isOver ? `1px dashed ${C.primary}` : undefined,
                          }}>
                          <span
                            onClick={() => setCollapsedFolders(f => { const n = new Set(f); isCollapsed ? n.delete(folder) : n.add(folder); return n; })}
                            style={{ fontSize: 10, color: C.muted, userSelect: "none", flexShrink: 0 }}>
                            {isCollapsed ? "▶" : "▼"}
                          </span>
                          <span style={{ fontSize: 11 }}>📁</span>
                          <span
                            onClick={() => setCollapsedFolders(f => { const n = new Set(f); isCollapsed ? n.delete(folder) : n.add(folder); return n; })}
                            style={{ fontSize: 12, fontWeight: 600, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {folder}
                          </span>
                          <span style={{ fontSize: 10, color: C.muted, flexShrink: 0 }}>{folderEps.length}</span>
                        </div>
                        {/* Folder endpoints */}
                        {!isCollapsed && folderEps.map(ep => (
                          <div
                            key={ep._id}
                            draggable
                            onDragStart={() => setDragEndpointId(ep._id)}
                            onDragEnd={() => { setDragEndpointId(null); setDragOverTarget(null); }}
                            onClick={() => setSelectedEndpoint(ep)}
                            style={{
                              padding: "8px 10px 8px 28px",
                              cursor: "pointer",
                              borderBottom: `1px solid ${C.border}`,
                              background: selectedEndpoint?._id === ep._id ? C.primary + "10" : dragEndpointId === ep._id ? "#f0f0f0" : "",
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                            <MethodBadge method={ep.method} />
                            <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ep.is_active ? C.text : C.muted }}>
                              {ep.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {/* Root (unfoldered) endpoints */}
                  {rootEndpoints.map(ep => (
                    <div
                      key={ep._id}
                      draggable
                      onDragStart={() => setDragEndpointId(ep._id)}
                      onDragEnd={() => { setDragEndpointId(null); setDragOverTarget(null); }}
                      onClick={() => setSelectedEndpoint(ep)}
                      style={{
                        padding: "9px 10px",
                        cursor: "pointer",
                        borderBottom: `1px solid ${C.border}`,
                        background: selectedEndpoint?._id === ep._id ? C.primary + "10" : dragEndpointId === ep._id ? "#f0f0f0" : "",
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                      <MethodBadge method={ep.method} />
                      <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ep.is_active ? C.text : C.muted }}>
                        {ep.name}
                      </span>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </div>

        {/* ── Endpoint detail / tabs ────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!selectedEndpoint ? (
            <div style={{ padding: 32, textAlign: "center", color: C.muted, background: C.surface, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
              Select an endpoint from the list or create one to get started.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {/* ── Endpoint headline ───────────────────────────────────── */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexShrink: 0 }}>
                <MethodBadge method={selectedEndpoint.method} />
                <span style={{ fontWeight: 600 }}>{selectedEndpoint.path}</span>
                <span style={{ fontSize: 12, color: C.muted }}>{selectedEndpoint.name}</span>
                {!selectedEndpoint.is_active && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "#f3f4f6", color: C.muted, border: `1px solid ${C.border}` }}>INACTIVE</span>
                )}
                <div style={{ flex: 1 }} />
                {can("edit:endpoints") && (
                  <button
                    onClick={() => setEndpointSettingsOpen(o => !o)}
                    title="Endpoint settings"
                    style={{
                      background: endpointSettingsOpen ? C.primary + "15" : "none",
                      border: `1px solid ${endpointSettingsOpen ? C.primary : C.border}`,
                      borderRadius: C.radius,
                      cursor: "pointer",
                      color: endpointSettingsOpen ? C.primary : C.muted,
                      fontSize: 14,
                      padding: "3px 8px",
                      lineHeight: 1,
                      flexShrink: 0,
                    }}>
                    ✎
                  </button>
                )}
              </div>

              {/* ── Inline endpoint settings panel ──────────────────────── */}
              {endpointSettingsOpen ? (
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <EndpointSettingsPanel
                    key={selectedEndpoint._id}
                    appId={appId!}
                    endpoint={selectedEndpoint}
                    onSaved={ep => {
                      setSelectedEndpoint(ep);
                      setEndpoints(prev => prev.map(e => e._id === ep._id ? ep : e));
                    }}
                    onDelete={() => setDeleteEndpoint(selectedEndpoint)}
                    onToggleActive={() => handleToggleActive(selectedEndpoint)}
                  />
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", borderBottom: `2px solid ${C.border}`, marginBottom: 16, overflowX: "auto", flexShrink: 0 }}>
                    {TABS.map(t => (
                      <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                        padding: "8px 14px", background: "none", border: "none", cursor: "pointer",
                        fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
                        color: activeTab === t.key ? C.primary : C.muted,
                        borderBottom: activeTab === t.key ? `2px solid ${C.primary}` : "2px solid transparent",
                        marginBottom: -2,
                      }}>{t.label}</button>
                    ))}
                  </div>

                  <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                    {activeTab === "request-schema"  && <RequestSchemaTab  key={selectedEndpoint._id} appId={appId!} endpoint={selectedEndpoint} onSaved={ep => setSelectedEndpoint(ep)} />}
                    {activeTab === "response-schema" && <ResponseSchemaTab key={selectedEndpoint._id} appId={appId!} endpoint={selectedEndpoint} onSaved={ep => setSelectedEndpoint(ep)} />}
                    {activeTab === "upstream"        && <UpstreamTab        key={selectedEndpoint._id} appId={appId!} endpoint={selectedEndpoint} app={app} onSaved={ep => setSelectedEndpoint(ep)} />}
                    {activeTab === "sample"          && <SampleTab          key={selectedEndpoint._id} appId={appId!} endpoint={selectedEndpoint} onSaved={ep => setSelectedEndpoint(ep)} />}
                    {activeTab === "mapping"         && <MappingTab         key={selectedEndpoint._id} appId={appId!} endpoint={selectedEndpoint} onSaved={ep => setSelectedEndpoint(ep)} />}
                    {activeTab === "test"            && <TestTab            key={selectedEndpoint._id} appId={appId!} endpoint={selectedEndpoint} app={app} />}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* ── Modals ─────────────────────────────────────────────────────── */}

      {showCloneApp && app && (
        <CloneAppModal
          source={app}
          onClose={() => setShowCloneApp(false)}
          onCloned={id => { setShowCloneApp(false); navigate(`/apps/${id}`); }}
        />
      )}

      {showAddEndpoint && (
        <AddEndpointModal
          appId={appId!}
          onClose={() => setShowAddEndpoint(false)}
          onCreated={ep => { setShowAddEndpoint(false); setEndpoints(prev => [...prev, ep]); setSelectedEndpoint(ep); setActiveTab("upstream"); }}
        />
      )}

      {editEndpoint && (
        <EditEndpointModal
          appId={appId!}
          endpoint={editEndpoint}
          onClose={() => setEditEndpoint(null)}
          onSaved={updated => {
            setEditEndpoint(null);
            setEndpoints(prev => prev.map(e => e._id === updated._id ? updated : e));
            if (selectedEndpoint?._id === updated._id) setSelectedEndpoint(updated);
          }}
        />
      )}

      {deleteEndpoint && (
        <Confirm
          danger
          message={`Delete ${deleteEndpoint.method} ${deleteEndpoint.path}? All its schema, mappings and sample data will be lost.`}
          onConfirm={() => handleDeleteEndpoint(deleteEndpoint)}
          onCancel={() => setDeleteEndpoint(null)}
        />
      )}
    </div>
  );
}

// ── EndpointSettingsPanel ─────────────────────────────────────────────────────

function EndpointSettingsPanel({ appId, endpoint, onSaved, onDelete, onToggleActive }: {
  appId: string;
  endpoint: Endpoint;
  onSaved: (ep: Endpoint) => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const [form, setForm] = useState({
    name:        endpoint.name,
    method:      endpoint.method,
    path:        endpoint.path,
    description: endpoint.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
    setSaved(false);
  };

  const methodChanged = form.method !== endpoint.method;
  const pathChanged   = form.path   !== endpoint.path;
  const breakingChange = methodChanged || pathChanged;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setSaving(true); setError(""); setSaved(false);
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`, form);
      onSaved(ep);
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: 20 }}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}

        {breakingChange && (
          <div style={{ padding: "8px 12px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 14 }}>
            <strong>⚠ Breaking change:</strong> Changing the{" "}
            {[methodChanged && "method", pathChanged && "path"].filter(Boolean).join(" and ")}{" "}
            will break any frontend client currently calling{" "}
            <code>{endpoint.method} {endpoint.path}</code>.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0 12px" }}>
          <Field label="Method">
            <select style={{ ...inputStyle, borderColor: methodChanged ? C.warning : C.border }} value={form.method} onChange={set("method")}>
              {["GET","POST","PUT","DELETE","PATCH"].map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Path">
            <input style={{ ...inputStyle, borderColor: pathChanged ? C.warning : C.border }} value={form.path} onChange={set("path")} placeholder="/claims" required />
          </Field>
        </div>

        <Field label="Name">
          <input style={inputStyle} value={form.name} onChange={set("name")} required />
        </Field>

        <Field label="Description">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56 }} value={form.description} onChange={set("description")} />
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: C.text }}>Status</span>
          <button type="button" onClick={onToggleActive} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 99, cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: endpoint.is_active ? "#e8f5e9" : "#f3f4f6",
            color: endpoint.is_active ? C.success : C.muted,
            border: `1px solid ${endpoint.is_active ? C.success : C.border}`,
          }}>
            <span style={{ fontSize: 10 }}>{endpoint.is_active ? "●" : "○"}</span>
            {endpoint.is_active ? "Active" : "Inactive"}
          </button>
          <span style={{ fontSize: 11, color: C.muted }}>{endpoint.is_active ? "Serving traffic" : "Not serving traffic"}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <Btn variant="ghost" type="button" onClick={onDelete} style={{ color: C.danger }}>
            Delete Endpoint
          </Btn>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {saved && <span style={{ fontSize: 12, color: C.success }}>✓ Saved</span>}
            <Btn type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Btn>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── EditAppModal ──────────────────────────────────────────────────────────────

function EditAppModal({ app, onClose, onSaved }: { app: App; onClose: () => void; onSaved: (updated: App) => void }) {
  const [form, setForm] = useState({ name: app.name, base_path: app.base_path, description: app.description, status: app.status });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pathTaken, setPathTaken] = useState(false);
  const [checking, setChecking] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const checkUnique = useCallback(async (path: string) => {
    if (!path || path === app.base_path) { setPathTaken(false); return; }
    setChecking(true);
    try {
      const d = await api.get<{ count: number; results: App[] }>(`/__config/apps?base_path=${encodeURIComponent(path)}`);
      // Taken if another app (different _id) already has this path
      setPathTaken(d.results.some(a => a._id !== app._id));
    } catch { setPathTaken(false); }
    finally { setChecking(false); }
  }, [app._id, app.base_path]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (pathTaken) return;
    setSaving(true); setError("");
    try {
      const updated = await api.put<App>(`/__config/apps/${app._id}`, form);
      onSaved(updated);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  const pathChanged = form.base_path !== app.base_path;
  const pathHint = checking ? "Checking…"
    : pathTaken ? "⚠ Already taken by another app"
    : pathChanged && !checking ? "✓ Available"
    : "The URL prefix all endpoints under this app will be called at";

  return (
    <Modal title="Edit App Settings" onClose={onClose} width={500}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}

        <Field label="App Name">
          <input style={inputStyle} value={form.name} onChange={set("name")} required />
        </Field>

        <Field label="Base Path" hint={pathHint}>
          <input
            style={{ ...inputStyle, borderColor: pathTaken ? C.danger : pathChanged && !checking ? C.success : C.border }}
            value={form.base_path}
            onChange={set("base_path")}
            onBlur={() => checkUnique(form.base_path)}
            required
          />
        </Field>

        {pathChanged && (
          <div style={{ padding: "8px 12px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
            <strong>Note:</strong> Changing the base path takes effect immediately. Any frontend clients calling{" "}
            <code>{app.base_path}</code> will get 404 until they update to <code>{form.base_path}</code>.
          </div>
        )}

        <Field label="Description">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56 }} value={form.description} onChange={set("description")} />
        </Field>

        <Field label="Status">
          <select style={inputStyle} value={form.status} onChange={set("status")}>
            <option value="draft">Draft — not serving traffic</option>
            <option value="active">Active — serving traffic</option>
            <option value="deprecated">Deprecated — serving with warning headers</option>
          </select>
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || pathTaken || checking}>
            {saving ? "Saving…" : "Save Settings"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// ── AddEndpointModal ──────────────────────────────────────────────────────────

function AddEndpointModal({ appId, onClose, onCreated }: { appId: string; onClose: () => void; onCreated: (ep: Endpoint) => void }) {
  const [form, setForm] = useState({ name: "", method: "GET", path: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      const ep = await api.post<Endpoint>(`/__config/apps/${appId}/endpoints`, {
        name: form.name, method: form.method, path: form.path, description: form.description,
      });
      onCreated(ep);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title="Add Endpoint" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0 12px" }}>
          <Field label="Method">
            <select style={inputStyle} value={form.method} onChange={set("method")}>
              {["GET","POST","PUT","DELETE","PATCH"].map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Path" hint="Relative path. e.g. /claims or /claims/{claimId}">
            <input style={inputStyle} value={form.path} onChange={set("path")} placeholder="/claims" required />
          </Field>
        </div>
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} placeholder="Claims List" required /></Field>
        <Field label="Description (optional)">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 50 }} value={form.description} onChange={set("description")} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Creating…" : "Create Endpoint"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ── EditEndpointModal ─────────────────────────────────────────────────────────

function EditEndpointModal({ appId, endpoint, onClose, onSaved }: {
  appId: string; endpoint: Endpoint; onClose: () => void; onSaved: (ep: Endpoint) => void;
}) {
  const [form, setForm] = useState({
    name:        endpoint.name,
    method:      endpoint.method,
    path:        endpoint.path,
    description: endpoint.description,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const methodChanged = form.method !== endpoint.method;
  const pathChanged   = form.path   !== endpoint.path;
  const breakingChange = methodChanged || pathChanged;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`, form);
      onSaved(ep);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title="Edit Endpoint" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}

        {breakingChange && (
          <div style={{ padding: "8px 12px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
            <strong>⚠ Breaking change:</strong> Changing the{" "}
            {[methodChanged && "method", pathChanged && "path"].filter(Boolean).join(" and ")}{" "}
            will break any frontend client currently calling{" "}
            <code>{endpoint.method} {endpoint.path}</code>. Make sure to update consumers before applying.
            Role-based approval for breaking changes will be enforced in a future release.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "0 12px" }}>
          <Field label="Method">
            <select style={{ ...inputStyle, borderColor: methodChanged ? C.warning : C.border }} value={form.method} onChange={set("method")}>
              {["GET","POST","PUT","DELETE","PATCH"].map(m => <option key={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Path">
            <input style={{ ...inputStyle, borderColor: pathChanged ? C.warning : C.border }} value={form.path} onChange={set("path")} placeholder="/claims" required />
          </Field>
        </div>
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} required /></Field>
        <Field label="Description">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 50 }} value={form.description} onChange={set("description")} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save Endpoint"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ── CloneAppModal ─────────────────────────────────────────────────────────────

function CloneAppModal({ source, onClose, onCloned }: { source: App; onClose: () => void; onCloned: (id: string) => void }) {
  const [name, setName]         = useState(`${source.name}-v2`);
  const [basePath, setBasePath] = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [pathTaken, setPathTaken] = useState(false);
  const [checking, setChecking]   = useState(false);

  const checkUnique = useCallback(async (path: string) => {
    if (!path) { setPathTaken(false); return; }
    setChecking(true);
    try {
      const d = await api.get<{ count: number; results: App[] }>(`/__config/apps?base_path=${encodeURIComponent(path)}`);
      setPathTaken(d.results.some(a => a._id !== source._id));
    } catch { setPathTaken(false); }
    finally { setChecking(false); }
  }, [source._id]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); if (pathTaken) return;
    setSaving(true); setError("");
    try {
      const app = await api.post<App>(`/__config/apps/${source._id}/clone`, { name, base_path: basePath });
      onCloned(app._id);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  const pathHint = checking ? "Checking…" : pathTaken ? "⚠ Already taken" : basePath && !checking ? "✓ Available" : `Cloning from: ${source.base_path}`;

  return (
    <Modal title={`Clone "${source.name}"`} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <div style={{ padding: "8px 12px", background: "#f0f7ff", borderRadius: C.radius, border: "1px solid #bee3f8", fontSize: 12, color: "#1e40af", marginBottom: 12 }}>
          All endpoints, schemas, upstreams, and mappings from <strong>{source.name}</strong> will be copied into the new app.
        </div>
        <Field label="New App Name"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} required autoFocus /></Field>
        <Field label="New Base Path" hint={pathHint}>
          <input style={{ ...inputStyle, borderColor: pathTaken ? C.danger : basePath && !checking ? C.success : C.border }}
            value={basePath} onChange={e => setBasePath(e.target.value)} onBlur={() => checkUnique(basePath)}
            placeholder={source.base_path.replace(/v(\d+)$/, (_, n) => `v${parseInt(n) + 1}`)} required />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || pathTaken || checking || !basePath}>{saving ? "Cloning…" : "Clone App"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

// ── ModeBadge ─────────────────────────────────────────────────────────────────

const MODE_STYLES: Record<string, { bg: string; color: string }> = {
  dev:     { bg: "#e8f5e9", color: "#2e7d32" },
  qa:      { bg: "#e3f2fd", color: "#1565c0" },
  staging: { bg: "#fff8e1", color: "#f57f17" },
  prod:    { bg: "#fce4ec", color: "#c62828" },
};

function ModeBadge({ mode }: { mode: string }) {
  const style = MODE_STYLES[mode] ?? { bg: C.bg, color: C.muted };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: style.bg, color: style.color, textTransform: "uppercase", letterSpacing: ".5px" }}>
      {mode}
    </span>
  );
}

