import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import type { App, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Modal, Field, inputStyle, Spinner, ErrorBanner, Confirm, C } from "../../components";
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
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();
  const { can } = useSession();

  async function load() {
    setLoading(true); setError("");
    try {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const d = await api.get<ListResult<App>>(`/__config/apps${params}`);
      setApps(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function handleDelete(app: App) {
    try { await api.del(`/__config/apps/${app._id}`); setDeleteTarget(null); load(); }
    catch (e) { alert(String(e)); }
  }

  const cols = [
    { key: "name", label: "Name" },
    {
      key: "base_path", label: "Base Path",
      render: (v: unknown) => (
        <code style={{ fontSize: 12, background: C.bg, padding: "1px 6px", borderRadius: 3 }}>{String(v)}</code>
      ),
    },
    { key: "status", label: "Status", render: (v: unknown) => <Badge text={String(v)} /> },
    { key: "created_at", label: "Created", render: (v: unknown) => new Date(String(v)).toLocaleDateString() },
    {
      key: "_id", label: "Actions",
      render: (_: unknown, row: Record<string, unknown>) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="outline" onClick={e => { e.stopPropagation(); navigate(`/apps/${row["_id"]}`); }}>Edit</Btn>
          {can("manage:apps") && (
            <Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setCloneSource(row as unknown as App); }}>Clone</Btn>
          )}
          {can("manage:apps") && (
            <Btn size="sm" variant="danger" onClick={e => { e.stopPropagation(); setDeleteTarget(row as unknown as App); }}>Delete</Btn>
          )}
        </div>
      ),
    },
  ];

  const tabs = ["all", "active", "draft", "deprecated"];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>App Registry</h1>
          <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>
            Each app is a versioned collection of endpoints with a unique base path.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {can("manage:apps") && <Btn variant="outline" onClick={() => setShowImport(true)}>Import App ↑</Btn>}
          {can("manage:apps") && <Btn onClick={() => setShowCreate(true)}>+ Create App</Btn>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setStatusFilter(t)} style={{
            padding: "7px 14px", background: "none", border: "none", cursor: "pointer",
            fontSize: 12, fontWeight: 600, textTransform: "capitalize",
            color: statusFilter === t ? C.primary : C.muted,
            borderBottom: statusFilter === t ? `2px solid ${C.primary}` : "2px solid transparent",
            marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title={`${apps.length} app${apps.length !== 1 ? "s" : ""}`}
          action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>}
        />
        {loading
          ? <Spinner />
          : <Table
              cols={cols as Parameters<typeof Table>[0]["cols"]}
              rows={apps as unknown as Record<string, unknown>[]}
              onRowClick={row => navigate(`/apps/${row["_id"]}`)}
            />}
      </Card>

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

        <div style={{ padding: "10px 12px", background: "#f0f7ff", borderRadius: C.radius, border: `1px solid #bee3f8`, fontSize: 12, color: "#1e40af", marginBottom: 14 }}>
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
