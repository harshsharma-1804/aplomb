import { usePageSave, useGuardedAction } from "../../components/PageSave";
import { Braces, ListTree, Network, FileJson, GitCompareArrows, FlaskConical, FolderPlus, Pencil, Search, Settings, Boxes, Users, Clock, FileCode2, Download, ChevronDown, ChevronRight } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { api } from "../../api/client";
import type { App, Endpoint, ListResult } from "../../api/types";
import { Btn, Badge, Spinner, ErrorBanner, Confirm, MethodBadge, C, Modal, Field, inputStyle } from "../../components";
import { useBreadcrumb } from "../../components/BreadcrumbContext";
import { useSession } from "../../auth/SessionContext";
import { RequestSchemaTab } from "./tabs/RequestSchemaTab";
import { ResponseSchemaTab } from "./tabs/ResponseSchemaTab";
import { UpstreamTab } from "./tabs/UpstreamTab";
import { SampleTab } from "./tabs/SampleTab";
import { MappingTab } from "./tabs/MappingTab";
import { TestTab } from "./tabs/TestTab";
import { SettingsTab, APP_SETTINGS_SECTIONS } from "./tabs/SettingsTab";
import { ScriptsTab } from "./tabs/ScriptsTab";
import { UsersTab } from "./tabs/UsersTab";
import { SessionsTab } from "./tabs/SessionsTab";
import { ExportAppModal } from "./ExportAppModal";

const TABS = [
  { key: "request-schema",  label: "Request Schema" },
  { key: "response-schema", label: "Response Schema" },
  { key: "upstream",        label: "Upstream" },
  { key: "sample",          label: "Sample" },
  { key: "mapping",         label: "Field Mapping" },
  { key: "test",            label: "Test" },
];

export function AppDetailPage() {
  const guard=useGuardedAction();
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useSession();

  const [app, setApp] = useState<App | null>(null);
  const [endpointQuery, setEndpointQuery] = useState("");
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint | null>(null);
  const [activeTab, setActiveTab] = useState("response-schema");
  const routeSection = location.pathname.split("/")[3];
  const topTab = ["users","sessions","scripts","settings"].includes(routeSection) ? routeSection : "endpoints";
  const setTopTab = (key:string) => navigate(`/apps/${appId}${key === "endpoints" ? "" : `/${key}`}`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddEndpoint, setShowAddEndpoint] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState<Endpoint | null>(null);
  const [deleteEndpoint, setDeleteEndpoint] = useState<Endpoint | null>(null);
  const [showCloneApp, setShowCloneApp] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [endpointSettingsOpen, setEndpointSettingsOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const EP_FOLDERS_KEY = `endpoint_folders_${appId}`;
  const [endpointFolders, setEndpointFolders] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`endpoint_folders_${appId}`) ?? "[]"); } catch { return []; }
  });
  function updateEndpointFolders(updater: (prev: string[]) => string[]) {
    setEndpointFolders(prev => {
      const next = updater(prev);
      try { localStorage.setItem(EP_FOLDERS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [dragEndpointId, setDragEndpointId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [addingInFolder, setAddingInFolder] = useState<string | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");

  function deleteEndpointFolder(folder: string) {
    // Move all endpoints in folder to root, then remove folder from state
    const toMove = endpoints.filter(ep => ep.folder === folder);
    Promise.all(toMove.map(ep => api.put(`/__config/apps/${appId}/endpoints/${ep._id}`, { folder: null })))
      .then(() => {
        setEndpoints(prev => prev.map(ep => ep.folder === folder ? { ...ep, folder: null } : ep));
        updateEndpointFolders(prev => prev.filter(f => f !== folder));
        setFolderMenuOpen(null);
      }).catch(() => {});
  }

  function renameEndpointFolder(oldName: string, newName: string) {
    if (!newName.trim() || newName === oldName) { setRenamingFolder(null); return; }
    const trimmed = newName.trim();
    const toRename = endpoints.filter(ep => ep.folder === oldName);
    Promise.all(toRename.map(ep => api.put(`/__config/apps/${appId}/endpoints/${ep._id}`, { folder: trimmed })))
      .then(() => {
        setEndpoints(prev => prev.map(ep => ep.folder === oldName ? { ...ep, folder: trimmed } : ep));
        updateEndpointFolders(prev => Array.from(new Set(prev.map(f => f === oldName ? trimmed : f))).sort());
        setRenamingFolder(null); setFolderMenuOpen(null);
      }).catch(() => {});
  }

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
      updateEndpointFolders(prev => {
        const fromServer = e.results.map(ep => ep.folder).filter(Boolean) as string[];
        const merged = Array.from(new Set([...prev, ...fromServer])).sort();
        return merged;
      });
      setSelectedEndpoint(prev => e.results.find(ep => ep._id === prev?._id) ?? e.results[0] ?? null);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [appId]);
  useEffect(() => { setEndpointSettingsOpen(false); }, [selectedEndpoint?._id]);
  useBreadcrumb(location.pathname, app ? [
    { label: "App Registry", to: "/apps" },
    { label: app.name, ...(topTab === "settings" ? { to:`/apps/${appId}` } : {}) },
    ...(topTab === "settings" ? [{label:"Settings", ...(location.pathname.split("/")[4] ? {to:`/apps/${appId}/settings`} : {})}] : []),
    ...(topTab === "settings" && location.pathname.split("/")[4] ? [{label:APP_SETTINGS_SECTIONS.find(s=>s.key===location.pathname.split("/")[4])?.label ?? "Settings"}] : []),
  ] : null);

  async function handleDeleteEndpoint(ep: Endpoint) {
    try {
      await api.del(`/__config/apps/${appId}/endpoints/${ep._id}`);
      setDeleteEndpoint(null);
      if (selectedEndpoint?._id === ep._id) setSelectedEndpoint(null);
      load();
    } catch (e) { /* The API client reports the failure through the shared toast. */ }
  }

  async function handleToggleActive(ep: Endpoint) {
    try {
      const updated = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${ep._id}`, { is_active: !ep.is_active });
      setEndpoints(prev => prev.map(e => e._id === updated._id ? updated : e));
      if (selectedEndpoint?._id === updated._id) setSelectedEndpoint(updated);
    } catch (e) { /* The API client reports the failure through the shared toast. */ }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  if (!app) return null;

  return (
    <div className="app-page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── App header ─────────────────────────────────────────────────── */}
      {topTab !== "settings" && <div className="ui-pagehead" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 className="app-detail-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{app.name}</h1>
            <Badge text={app.status} />
            {app.mode && <Badge text={app.mode} />}
            {app.auth_required === false && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "var(--warning-background)", color: "var(--warning)", border: "1px solid var(--warning)" }}>
                🔓 AUTH OFF
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontSize: 12, color: C.muted, background: C.bg, padding: "2px 8px", borderRadius: 3 }}>{app.base_path}</code>
            <span style={{ fontSize: 11, color: C.muted }}>→ frontend calls this prefix + endpoint path</span>
          </div>
        </div>
        <div className="ui-row app-detail-header-actions">
          <div data-page-save-slot />
          {can("export:app") && <Btn variant="secondary" onClick={() => setShowExport(true)}><Download />Export</Btn>}
          <Btn variant="secondary" aria-pressed={topTab === "settings"} onClick={() => setTopTab("settings")}><Settings />Settings</Btn>
        </div>
      </div>}

      {/* ── Top-level tabs: Endpoints | Settings ───────────────────────── */}
      {topTab !== "settings" && <div className="ui-tabs app-detail-tabs" aria-label="Application sections">
        {[{key:"endpoints",label:"Endpoints",icon:Boxes},{key:"users",label:"Users",icon:Users},{key:"sessions",label:"Sessions",icon:Clock},{key:"scripts",label:"Scripts",icon:FileCode2}].map(t=><button type="button" key={t.key} className={`ui-tab ${topTab===t.key ? "is-active" : ""}`} aria-pressed={topTab===t.key} onClick={()=>setTopTab(t.key)}><t.icon />{t.label}{t.key==="endpoints" && <span className="ui-count">{endpoints.length}</span>}</button>)}
      </div>}

      {/* ── Users tab (gateway-auth app users) ─────────────────────────── */}
      {topTab === "users" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <UsersTab appId={appId!} app={app} />
        </div>
      )}

      {/* ── Sessions tab (active devices + revoke) ─────────────────────── */}
      {topTab === "sessions" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <SessionsTab appId={appId!} />
        </div>
      )}

      {/* ── Scripts tab ────────────────────────────────────────────────── */}
      {topTab === "scripts" && (
        <div style={{ flex: 1, minHeight: 0, border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden", background: C.surface }}>
          <ScriptsTab appId={appId!} />
        </div>
      )}

      {/* ── Settings tab ───────────────────────────────────────────────── */}
      {topTab === "settings" && (
        <div className="app-settings-page">
          <SettingsTab
            section={location.pathname.split("/")[4]}
            onRestored={load}
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
      {topTab === "endpoints" && <div className="app-editor-grid" style={{ display: "grid", gridTemplateColumns: "284px minmax(0,1fr)", gap: 16, alignItems: "stretch", flex: 1, minHeight: 0 }}>

        {/* ── Endpoint sidebar ─────────────────────────────────────────── */}
        <div className="app-endpoint-tree" style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Header */}
          <div style={{ flexShrink: 0 }}>
            <div className="ui-row" style={{ padding:"10px 10px 4px" }}>
              <div className="ui-search ui-grow"><Search /><input className="ui-input ui-input--sm" aria-label="Filter endpoints" placeholder="Filter endpoints" value={endpointQuery} onChange={e=>setEndpointQuery(e.target.value)} /></div>
              {can("edit:endpoints") && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    onClick={() => { setShowAddFolder(f => !f); setNewFolderName(""); }}
                    title="New folder"
                    style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: C.radius, cursor: "pointer", color: C.muted, fontSize: 12, padding: "2px 7px", lineHeight: 1.4 }}>
                    <FolderPlus size={14} />
                  </button>
                  <Btn size="sm" aria-label="New endpoint" style={{width:30,padding:0}} onClick={() => setShowAddEndpoint(true)}>+</Btn>
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
                      if (e.key === "Enter") {
                        const name = newFolderName.trim();
                        if (!name) return;
                        updateEndpointFolders(prev => Array.from(new Set([...prev, name])).sort());
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
                      updateEndpointFolders(prev => Array.from(new Set([...prev, name])).sort());
                      setCollapsedFolders(f => { const n = new Set(f); n.delete(name); return n; });
                      setShowAddFolder(false); setNewFolderName("");
                    }}
                    style={{ fontSize: 11, padding: "4px 8px", border: `1px solid ${C.primary}`, borderRadius: C.radius, background: C.primary, color: C.primaryText, cursor: "pointer" }}>
                    Add
                  </button>
                </div>
                <p style={{ fontSize: 10, color: C.muted, margin: "4px 0 0" }}>Use + in folder to add endpoints, or drag existing ones in.</p>
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
            {endpoints.length === 0 && endpointFolders.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: C.muted, textAlign: "center" }}>No endpoints yet</div>
            ) : (() => {
              const rootEndpoints = endpoints.filter(ep => !ep.folder && `${ep.method} ${ep.name} ${ep.path}`.toLowerCase().includes(endpointQuery.toLowerCase()));

              return (
                <>
                  {/* Folders (from state — allows empty folders) */}
                  {endpointFolders.map(folder => {
                    const folderEps = endpoints.filter(ep => ep.folder === folder && `${ep.method} ${ep.name} ${ep.path}`.toLowerCase().includes(endpointQuery.toLowerCase()));
                    if (endpointQuery && !folderEps.length) return null;
                    const isCollapsed = !endpointQuery && collapsedFolders.has(folder);
                    const isOver = dragOverTarget === folder;
                    const isMenuOpen = folderMenuOpen === folder;
                    const isRenaming = renamingFolder === folder;
                    return (
                      <div key={folder}>
                        {/* Folder header row */}
                        <div className="app-tree-group"
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverTarget(folder); }}
                          onDrop={e => {
                            e.preventDefault(); e.stopPropagation();
                            if (!dragEndpointId) return;
                            api.put(`/__config/apps/${appId}/endpoints/${dragEndpointId}`, { folder })
                              .then(() => setEndpoints(prev => prev.map(ep => ep._id === dragEndpointId ? { ...ep, folder } : ep)))
                              .catch(() => {});
                            setDragEndpointId(null); setDragOverTarget(null);
                          }}
                          style={{
                            display: "flex", alignItems: "center", gap: 6,
                            padding: "8px 10px", cursor: "pointer",
                            borderBottom: "none",
                            background: isOver ? C.selection : "none",
                            outline: isOver ? `1px dashed ${C.primary}` : undefined,
                            position: "relative",
                          }}>
                          <span
                            onClick={() => setCollapsedFolders(f => { const n = new Set(f); isCollapsed ? n.delete(folder) : n.add(folder); return n; })}
                            style={{ fontSize: 10, color: C.muted, userSelect: "none", flexShrink: 0 }}>
                            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          </span>
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameFolderValue}
                              onChange={e => setRenameFolderValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") renameEndpointFolder(folder, renameFolderValue);
                                if (e.key === "Escape") { setRenamingFolder(null); setFolderMenuOpen(null); }
                              }}
                              onBlur={() => renameEndpointFolder(folder, renameFolderValue)}
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
                          <span className="ui-count">{folderEps.length}</span>
                          {can("edit:endpoints") && !isRenaming && (
                            <>
                              <button
                                title={`Add endpoint in ${folder}`}
                                onClick={e => { e.stopPropagation(); setAddingInFolder(folder); setShowAddEndpoint(true); }}
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
                              onClick={e => { e.stopPropagation(); deleteEndpointFolder(folder); }}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.danger }}
                              onMouseEnter={el => (el.currentTarget.style.background = "var(--danger-background)")}
                              onMouseLeave={el => (el.currentTarget.style.background = "none")}>
                              🗑 Delete folder{folderEps.length > 0 ? ` (moves ${folderEps.length} endpoint${folderEps.length > 1 ? "s" : ""} to root)` : ""}
                            </button>
                          </div>
                        )}
                        
                        {/* Folder endpoints */}
                        {!isCollapsed && folderEps.map(ep => (
                          <button type="button" className="ui-tree__item app-endpoint-row"
                            key={ep._id}
                            draggable
                            onDragStart={() => setDragEndpointId(ep._id)}
                            onDragEnd={() => { setDragEndpointId(null); setDragOverTarget(null); }}
                            aria-pressed={selectedEndpoint?._id === ep._id}
                            onClick={() => {if(ep._id!==selectedEndpoint?._id)guard(()=>setSelectedEndpoint(ep));}}
                            style={{
                              padding: "6px 9px 6px 22px", cursor: "pointer",
                              borderBottom: "none",
                              background: selectedEndpoint?._id === ep._id ? C.selection : dragEndpointId === ep._id ? "var(--surface-muted)" : "",
                              display: "flex", alignItems: "center", gap: 6,
                            }}>
                            <MethodBadge method={ep.method} />
                            <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ep.is_active ? C.text : C.muted }}>
                              {ep.name}
                            </span>
                          </button>
                        ))}
                        {/* Empty folder drop hint */}
                        {!isCollapsed && folderEps.length === 0 && (
                          <div style={{ padding: "6px 9px 6px 22px", fontSize: 11, color: C.muted, fontStyle: "italic", borderBottom: `1px solid ${C.border}` }}>
                            Drag endpoints here or use +
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Root (unfoldered) endpoints */}
                  {rootEndpoints.map(ep => (
                    <button type="button" className="ui-tree__item app-endpoint-row"
                      key={ep._id}
                      draggable
                      onDragStart={() => setDragEndpointId(ep._id)}
                      onDragEnd={() => { setDragEndpointId(null); setDragOverTarget(null); }}
                      aria-pressed={selectedEndpoint?._id === ep._id}
                            onClick={() => {if(ep._id!==selectedEndpoint?._id)guard(()=>setSelectedEndpoint(ep));}}
                      style={{
                        padding: "6px 9px", cursor: "pointer",
                        borderBottom: "none",
                        background: selectedEndpoint?._id === ep._id ? C.selection : dragEndpointId === ep._id ? "var(--surface-muted)" : "",
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                      <MethodBadge method={ep.method} />
                      <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ep.is_active ? C.text : C.muted }}>
                        {ep.name}
                      </span>
                    </button>
                  ))}
                </>
              );
            })()}
          </div>
        </div>

        {/* ── Endpoint detail / tabs ────────────────────────────────────── */}
        <div className="app-editor-pane" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!selectedEndpoint ? (
            <div style={{ padding: 32, textAlign: "center", color: C.muted, background: C.surface, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
              Select an endpoint from the list or create one to get started.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {/* ── Endpoint headline ───────────────────────────────────── */}
              <div className="app-endpoint-head" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexShrink: 0 }}>
                <MethodBadge method={selectedEndpoint.method} />
                <span style={{ fontWeight: 600 }}>{selectedEndpoint.path}</span>
                <span style={{ fontSize: 12, color: C.muted }}>{selectedEndpoint.name}</span>
                {!selectedEndpoint.is_active && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: C.surfaceMuted, color: C.muted, border: `1px solid ${C.border}` }}>INACTIVE</span>
                )}
                <div style={{ flex: 1 }} />
                {can("edit:endpoints") && (
                  <button
                    onClick={() => guard(()=>setEndpointSettingsOpen(o => !o))}
                    title="Endpoint settings"
                    style={{
                      background: endpointSettingsOpen ? C.selection : "none",
                      border: `1px solid ${endpointSettingsOpen ? C.primary : C.border}`,
                      borderRadius: C.radius,
                      cursor: "pointer",
                      color: endpointSettingsOpen ? C.primary : C.muted,
                      fontSize: 14,
                      padding: "3px 8px",
                      lineHeight: 1,
                      flexShrink: 0,
                    }}>
                    <Pencil size={15} />
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
                  <nav className="ui-stepper app-endpoint-stepper" aria-label="Endpoint configuration steps">
                    {TABS.map((t,i)=>{
                      const ep=selectedEndpoint;
                      const inputCount=ep.request?.input_schema?.length ?? 0, outputCount=ep.output_schema?.length ?? 0, mappingCount=ep.field_mappings?.length ?? 0;
                      const StepIcon=[Braces,ListTree,Network,FileJson,GitCompareArrows,FlaskConical][i];
                      const meta=[`${inputCount} fields · ${ep.request?.validation ?? "strict"}`,`${outputCount} fields`,ep.script_mode!=="none" ? "Script handler" : ep.upstream?.upstream_type ?? "HTTP",ep.sample_response ? "Captured" : "Capture data",`${mappingCount} mapped`,"Run a request"][i];
                      return <button type="button" key={t.key} className={`ui-step ${activeTab===t.key ? "is-current" : ""}`} aria-current={activeTab===t.key ? "step" : undefined} onClick={()=>{if(activeTab!==t.key)guard(()=>setActiveTab(t.key));}}><span className="ui-step__dot">{<StepIcon/>}</span><span className="ui-step__text"><span className="ui-step__label">{["Request","Response","Upstream","Sample","Mapping","Test"][i]}</span><span className="ui-step__meta">{meta}</span></span></button>;
                    })}
                  </nav>

                  <div className="app-editor-body ui-page__body" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
      {showExport && app && (
        <ExportAppModal app={app} onClose={() => setShowExport(false)} />
      )}

      {showAddEndpoint && (
        <AddEndpointModal
          appId={appId!}
          folder={addingInFolder}
          onClose={() => { setShowAddEndpoint(false); setAddingInFolder(null); }}
          onCreated={ep => {
            setShowAddEndpoint(false); setAddingInFolder(null);
            setEndpoints(prev => [...prev, ep]);
            if (ep.folder) updateEndpointFolders(prev => Array.from(new Set([...prev, ep.folder!])).sort());
            setSelectedEndpoint(ep); setActiveTab("upstream");
          }}
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
    identity_args: (endpoint.identity_args ?? []).join(", "),
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

  usePageSave(form,save,{disabled:saving || !form.name || !form.path});

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const identityArgs = form.identity_args.split(",").map(s => s.trim()).filter(Boolean);
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}`, {
        name: form.name, method: form.method, path: form.path, description: form.description,
        identity_args: identityArgs,
      });
      onSaved(ep);
      setSaved(true);
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radius, padding: 20 }}>
      <form onSubmit={ev=>{ev.preventDefault();void save();}}>
        {error && <ErrorBanner message={error} />}

        {breakingChange && (
          <div style={{ padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 14 }}>
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

        <Field
          label="Identity arguments"
          hint="Comma-separated arg names that carry the end-user identity (e.g. memberId). In session mode the gateway forces these to the verified session ID — the LLM's value is discarded."
        >
          <input
            style={inputStyle}
            value={form.identity_args}
            onChange={set("identity_args")}
            placeholder="e.g. memberId"
          />
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, marginBottom: 16 }}>
          <span style={{ fontSize: 13, color: C.text }}>Status</span>
          <button type="button" onClick={onToggleActive} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 99, cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: endpoint.is_active ? "var(--success-background)" : C.surfaceMuted,
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
            <Btn pageSave type="submit" disabled={saving}>
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
          <div style={{ padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 12 }}>
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

function AddEndpointModal({ appId, folder, onClose, onCreated }: { appId: string; folder?: string | null; onClose: () => void; onCreated: (ep: Endpoint) => void }) {
  const [form, setForm] = useState({ name: "", method: "GET", path: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      const ep = await api.post<Endpoint>(`/__config/apps/${appId}/endpoints`, {
        name: form.name, method: form.method, path: form.path, description: form.description,
        ...(folder ? { folder } : {}),
      });
      onCreated(ep);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title={folder ? `Add Endpoint — ${folder}` : "Add Endpoint"} onClose={onClose}>
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
          <div style={{ padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 12 }}>
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
        <div style={{ padding: "8px 12px", background: "var(--selection)", borderRadius: C.radius, border: "1px solid var(--border)", fontSize: 12, color: "var(--primary)", marginBottom: 12 }}>
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
  dev:     { bg: "var(--success-background)", color: "var(--success)" },
  qa:      { bg: "var(--selection)", color: "var(--primary)" },
  staging: { bg: "var(--warning-background)", color: "var(--warning)" },
  prod:    { bg: "var(--danger-background)", color: "var(--danger)" },
};

function ModeBadge({ mode }: { mode: string }) {
  const style = MODE_STYLES[mode] ?? { bg: C.bg, color: C.muted };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: style.bg, color: style.color, textTransform: "uppercase", letterSpacing: ".5px" }}>
      {mode}
    </span>
  );
}

