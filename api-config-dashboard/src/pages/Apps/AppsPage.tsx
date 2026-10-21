import { Boxes, Copy, Plus, Search, Upload, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { App, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Modal, Field, inputStyle, Spinner, ErrorBanner, Confirm, Stat, RowMenu, C } from "../../components";
import { useSession } from "../../auth/SessionContext";
import { ImportAppModal } from "./ImportAppModal";

export function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [cloneSource, setCloneSource] = useState<App | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<App | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();
  const { can } = useSession();

  async function load() {
    setLoading(true); setError("");
    try {
      const params = "";
      const d = await api.get<ListResult<App>>(`/__config/apps${params}`);
      setApps(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(app: App) {
    try { await api.del(`/__config/apps/${app._id}`); setDeleteTarget(null); load(); }
    catch (e) { /* The API client reports the failure through the shared toast. */ }
  }

  const cols = [
    { key:"name",label:"App",render:(v:unknown)=><div className="ui-row" style={{gap:12}}><span className="ui-tile">{String(v).split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}</span><span style={{fontWeight:600}}>{String(v)}</span></div> },
    {
      key: "base_path", label: "Base Path",
      render: (v: unknown) => (
        <span className="ui-path">{String(v)}</span>
      ),
    },
    { key: "status", label: "Status", render: (v: unknown) => <Badge text={String(v)} /> },
    { key: "created_at", label: "Created", render: (v: unknown) => new Date(String(v)).toLocaleDateString() },
    {key:"_id",label:"",render:(_:unknown,row:Record<string,unknown>)=><RowMenu items={[
      {label:"Edit",icon:<Pencil />,onClick:()=>navigate(`/apps/${row._id}`)},
      ...(can("manage:apps") ? [{label:"Clone",icon:<Copy />,onClick:()=>setCloneSource(row as unknown as App)},{label:"Delete",icon:<Trash2 />,danger:true,onClick:()=>setDeleteTarget(row as unknown as App)}] : []),
    ]} />},
  ];

  const tabs = ["all", "active", "draft", "deprecated"];

  return (
    <div className="app-page">
      <div className="ui-pagehead" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>App Registry</h1>
          <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>
            Each app is a versioned collection of endpoints with a unique base path.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {can("manage:apps") && <Btn variant="secondary" onClick={() => setShowImport(true)}><Upload />Import</Btn>}
          {can("manage:apps") && <Btn onClick={() => setShowCreate(true)}><Plus />New app</Btn>}
        </div>
      </div>

      <div className="ui-page__body"><div className="ui-row app-apps-toolbar" style={{marginBottom:20}}><div className="ui-seg">{tabs.map(t=><button type="button" key={t} className={`ui-seg__item ${statusFilter===t ? "is-active" : ""}`} aria-pressed={statusFilter===t} onClick={()=>setStatusFilter(t)}><span style={{textTransform:"capitalize"}}>{t}</span><span className="ui-count">{t==="all" ? apps.length : apps.filter(a=>a.status===t).length}</span></button>)}</div><div className="ui-grow" /><div className="ui-search" style={{width:260}}><Search /><input className="ui-input" aria-label="Search applications" placeholder="Filter by name or path" value={query} onChange={e=>setQuery(e.target.value)} /></div><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh" onClick={load}><RefreshCw /></button></div>

      {error && <ErrorBanner message={error} />}

      <Card>
        {loading
          ? <Spinner />
          : <Table
              cols={cols as Parameters<typeof Table>[0]["cols"]}
              rows={apps.filter(a => (statusFilter === "all" || a.status === statusFilter) && `${a.name} ${a.base_path}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string, unknown>[]}
              onRowClick={row => navigate(`/apps/${row["_id"]}`)}
            />}
      </Card>

      </div>
      {showCreate && (
        <CreateAppModal
          onClose={() => setShowCreate(false)}
          onCreated={id => { setShowCreate(false); navigate(`/apps/${id}`); }}
        />
      )}

      {showImport && (
        <ImportAppModal
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}

      {cloneSource && (
        <CloneAppModal
          source={cloneSource}
          onClose={() => setCloneSource(null)}
          onCloned={id => { setCloneSource(null); navigate(`/apps/${id}`); }}
        />
      )}

      {deleteTarget && (
        <Confirm
          danger
          message={`Delete app "${deleteTarget.name}" and all its endpoints? This cannot be undone.`}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Create App Modal ──────────────────────────────────────────────────────────

function CreateAppModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ name: "", base_path: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pathTaken, setPathTaken] = useState(false);
  const [checking, setChecking] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const checkUnique = useCallback(async (path: string) => {
    if (!path) { setPathTaken(false); return; }
    setChecking(true);
    try {
      const d = await api.get<{ count: number }>(`/__config/apps?base_path=${encodeURIComponent(path)}`);
      setPathTaken(d.count > 0);
    } catch { setPathTaken(false); }
    finally { setChecking(false); }
  }, []);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (pathTaken) return;
    setSaving(true); setError("");
    try {
      const app = await api.post<App>("/__config/apps", form);
      onCreated(app._id);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title="Create App" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <Field label="Name">
          <input style={inputStyle} value={form.name} onChange={set("name")} placeholder="member-1" required />
        </Field>
        <Field
          label="Base Path"
          hint={
            checking ? "Checking…"
            : pathTaken ? "⚠ This base path is already taken"
            : form.base_path ? "✓ Available"
            : "Unique URL prefix the frontend will call. e.g. /api/member/v1"
          }
        >
          <input
            style={{
              ...inputStyle,
              borderColor: pathTaken ? C.danger : form.base_path && !checking ? C.success : C.border,
            }}
            value={form.base_path}
            onChange={set("base_path")}
            onBlur={() => checkUnique(form.base_path)}
            placeholder="/api/member/v1"
            required
          />
        </Field>
        <Field label="Description">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={form.description} onChange={set("description")} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || pathTaken || checking}>
            {saving ? "Creating…" : "Create App"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

// ── Clone App Modal ───────────────────────────────────────────────────────────

function CloneAppModal({
  source,
  onClose,
  onCloned,
}: {
  source: App;
  onClose: () => void;
  onCloned: (id: string) => void;
}) {
  const [name, setName] = useState(`${source.name}-v2`);
  const [basePath, setBasePath] = useState("");
  const [description, setDescription] = useState(source.description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pathTaken, setPathTaken] = useState(false);
  const [checking, setChecking] = useState(false);

  const checkUnique = useCallback(async (path: string) => {
    if (!path) { setPathTaken(false); return; }
    setChecking(true);
    try {
      const d = await api.get<{ count: number }>(`/__config/apps?base_path=${encodeURIComponent(path)}`);
      setPathTaken(d.count > 0);
    } catch { setPathTaken(false); }
    finally { setChecking(false); }
  }, []);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (pathTaken) return;
    setSaving(true); setError("");
    try {
      const app = await api.post<App>(`/__config/apps/${source._id}/clone`, {
        name,
        base_path: basePath,
        description,
      });
      onCloned(app._id);
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  const sourcePathHint = `Cloning from: ${source.base_path}`;

  return (
    <Modal title={`Clone "${source.name}"`} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}

        <div style={{ padding: "10px 12px", background: "var(--selection)", borderRadius: C.radius, border: `1px solid var(--border)`, fontSize: 12, color: "var(--primary)", marginBottom: 14 }}>
          All endpoints, schemas, upstreams, and field mappings from <strong>{source.name}</strong> will be copied.
          You choose the new name and base path — the upstream URLs and mappings remain editable after cloning.
        </div>

        <Field label="New App Name">
          <input
            style={inputStyle}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="member-2"
            required
            autoFocus
          />
        </Field>

        <Field
          label="New Base Path"
          hint={
            checking ? "Checking…"
            : pathTaken ? "⚠ This base path is already taken"
            : basePath && !checking ? "✓ Available"
            : sourcePathHint
          }
        >
          <input
            style={{
              ...inputStyle,
              borderColor: pathTaken ? C.danger : basePath && !checking ? C.success : C.border,
            }}
            value={basePath}
            onChange={e => setBasePath(e.target.value)}
            onBlur={() => checkUnique(basePath)}
            placeholder={`${source.base_path.replace(/v\d+$/, "v2")}`}
            required
          />
        </Field>

        <Field label="Description">
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 50 }}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving || pathTaken || checking || !basePath}>
            {saving ? "Cloning…" : "Clone App"}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
