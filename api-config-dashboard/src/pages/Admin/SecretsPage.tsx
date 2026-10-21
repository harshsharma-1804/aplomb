import { Plus } from "lucide-react";
import { PageHeaderActions } from "../../components/PageSave";
import { CollectionHead } from "../../components/CollectionHead";
import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { Secret, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Modal, Field, inputStyle, Spinner, ErrorBanner, Confirm, C, DeleteIcon } from "../../components";

export function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [query,setQuery]=useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<Secret | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Secret | null>(null);

  async function load() {
    setLoading(true);
    try { const d = await api.get<ListResult<Secret>>("/__config/admin/secrets"); setSecrets(d.results); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const cols = [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "value", label: "Value", render: () => <span style={{ color: C.muted, fontFamily: "monospace" }}>••••••••</span> },
    { key: "created_at", label: "Created", render: (v: unknown) => new Date(String(v)).toLocaleDateString() },
    { key: "rotated_at", label: "Last Rotated", render: (v: unknown) => v ? new Date(String(v)).toLocaleDateString() : "Never" },
    { key: "_id", label: "", render: (_: unknown, row: Record<string, unknown>) => (
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => setRotateTarget(row as unknown as Secret)}>Rotate</Btn>
        <DeleteIcon onClick={() => setDeleteTarget(row as unknown as Secret)} label={`Delete secret ${row.name}`} />
      </div>
    )},
  ];

  return (
    <div>
      <PageHeaderActions><Btn onClick={()=>setShowCreate(true)}><Plus/>Add secret</Btn></PageHeaderActions>
      {error && <ErrorBanner message={error} />}
      <Card>
        <CollectionHead count={secrets.length} noun="secrets" query={query} onQuery={setQuery} onRefresh={load}/>
        {loading ? <Spinner /> : <Table cols={cols as Parameters<typeof Table>[0]["cols"]} rows={secrets.filter(p=>`${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string, unknown>[]} />}
      </Card>
      {showCreate && <SecretFormModal title="Add Secret" onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />}
      {rotateTarget && <SecretFormModal title={`Rotate — ${rotateTarget.name}`} secretId={rotateTarget._id} onClose={() => setRotateTarget(null)} onSaved={() => { setRotateTarget(null); load(); }} />}
      {deleteTarget && <Confirm danger message={`Delete secret "${deleteTarget.name}"? Any endpoint using it will fail until updated.`} onConfirm={async () => { await api.del(`/__config/admin/secrets/${deleteTarget._id}`); setDeleteTarget(null); load(); }} onCancel={() => setDeleteTarget(null)} />}
    </div>
  );
}

function SecretFormModal({ title, secretId, onClose, onSaved }: { title: string; secretId?: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      if (secretId) { await api.post(`/__config/admin/secrets/${secretId}/rotate`, { value }); }
      else { await api.post("/__config/admin/secrets", { name, description, value }); }
      onSaved();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        {!secretId && (
          <>
            <Field label="Name"><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="mulesoft-api-key" required /></Field>
            <Field label="Description"><input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} /></Field>
          </>
        )}
        <Field label="Secret Value" hint="Write-only — will never be shown after saving.">
          <input style={inputStyle} type="password" autoComplete="new-password" value={value} onChange={e => setValue(e.target.value)} required />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : (secretId ? "Rotate" : "Create")}</Btn>
        </div>
      </form>
    </Modal>
  );
}
