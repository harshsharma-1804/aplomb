import { Plus } from "lucide-react";
import { PageHeaderActions } from "../../components/PageSave";
import { CollectionHead } from "../../components/CollectionHead";
import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { AdminUser, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Modal, Field, inputStyle, Spinner, ErrorBanner, Confirm, C } from "../../components";
import { useSession } from "../../auth/SessionContext";

export function UsersPage() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query,setQuery]=useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUser | null>(null);

  async function load() {
    setLoading(true);
    try { const d = await api.get<ListResult<AdminUser>>("/__config/admin/users"); setUsers(d.results); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function handleDeactivate(u: AdminUser) {
    try { await api.del(`/__config/admin/users/${u._id}`); setDeactivateTarget(null); load(); }
    catch (e) { /* The API client reports the failure through the shared toast. */ }
  }

  const cols = [
    { key: "username", label: "Username" },
    { key: "email", label: "Email" },
    { key: "role", label: "Role", render: (v: unknown) => <Badge text={String(v)} /> },
    { key: "is_active", label: "Status", render: (v: unknown) => <Badge text={v ? "active" : "inactive"} /> },
    { key: "last_login_at", label: "Last Login", render: (v: unknown) => v ? new Date(String(v)).toLocaleString() : "Never" },
    { key: "_id", label: "", render: (_: unknown, row: Record<string, unknown>) => {
      const isSelf = row["_id"] === (me as any)?._id || row["username"] === me?.username;
      return (
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="ghost" onClick={() => setResetTarget(row as unknown as AdminUser)}>Reset Password</Btn>
          {!isSelf && Boolean(row["is_active"]) && <Btn size="sm" variant="danger" onClick={() => setDeactivateTarget(row as unknown as AdminUser)}>Deactivate</Btn>}
          {isSelf && <span style={{ fontSize: 11, color: C.muted, padding: "5px 0" }}>you</span>}
        </div>
      );
    }},
  ];

  return (
    <div>
      <PageHeaderActions><Btn onClick={()=>setShowCreate(true)}><Plus/>Add admin</Btn></PageHeaderActions>
      {error && <ErrorBanner message={error} />}
      <Card>
        <CollectionHead count={users.length} noun="admins" query={query} onQuery={setQuery} onRefresh={load}/>
        {loading ? <Spinner /> : <Table cols={cols as Parameters<typeof Table>[0]["cols"]} rows={users.filter(p=>`${p.username} ${p.email} ${p.role}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string, unknown>[]} />}
      </Card>
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {resetTarget && <ResetPasswordModal user={resetTarget} onClose={() => setResetTarget(null)} />}
      {deactivateTarget && <Confirm danger message={`Deactivate "${deactivateTarget.username}"? They will no longer be able to log in.`} onConfirm={() => handleDeactivate(deactivateTarget)} onCancel={() => setDeactivateTarget(null)} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "viewer" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try { await api.post("/__config/admin/users", form); onCreated(); }
    catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title="Add Admin User" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <Field label="Username"><input style={inputStyle} value={form.username} onChange={set("username")} required /></Field>
        <Field label="Email"><input style={inputStyle} type="email" value={form.email} onChange={set("email")} required /></Field>
        <Field label="Password" hint="Minimum 12 characters"><input style={inputStyle} type="password" value={form.password} onChange={set("password")} required /></Field>
        <Field label="Role"><select style={inputStyle} value={form.role} onChange={set("role")}><option value="viewer">Viewer</option><option value="sub_admin">Sub Admin</option><option value="admin">Admin</option></select></Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Creating…" : "Create"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try { await api.post(`/__config/admin/users/${user._id}/reset-password`, { password }); setDone(true); }
    catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title={`Reset — ${user.username}`} onClose={onClose}>
      {done ? <div><p style={{ color: C.success, marginBottom: 12 }}>Password reset successfully.</p><Btn onClick={onClose}>Close</Btn></div>
        : <form onSubmit={submit}>
            {error && <ErrorBanner message={error} />}
            <Field label="New Password" hint="Minimum 12 characters"><input style={inputStyle} type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus /></Field>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
              <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Reset"}</Btn>
            </div>
          </form>}
    </Modal>
  );
}
