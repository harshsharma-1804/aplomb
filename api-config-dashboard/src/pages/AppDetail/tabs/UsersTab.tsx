import { useState, useEffect, useCallback } from "react";
import { api } from "../../../api/client";
import type { AppUser, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Confirm, Badge, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

/**
 * Per-app gateway-auth users (AppScopedSessions-9).
 * These users can ONLY log in to this app via POST {base_path}/login —
 * they are fully disjoint from dashboard admin users.
 */
export function UsersTab({ appId, app }: { appId: string; app: { base_path: string; session_method?: string; auth_mode?: string } }) {
  const { can } = useSession();
  const readonly = !can("manage:apps");
  const gatewayOn = (app.auth_mode ?? "bearer") !== "bearer" && ["gateway", "both"].includes(app.session_method ?? "both");

  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [resetUser, setResetUser] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await api.get<ListResult<AppUser>>(`/__config/apps/${appId}/users`);
      setUsers(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [appId]);

  useEffect(() => { load(); }, [load]);

  if (!gatewayOn) {
    return (
      <Card>
        <SectionHead title="App Users" />
        <div style={{ padding: 16 }}>
          <div style={{ padding: "10px 14px", background: "#f0f7ff", borderRadius: C.radius, border: "1px solid #bee3f8", fontSize: 12, color: "#1e40af" }}>
            Gateway auth is not enabled for this app. Turn it on in <strong>Settings → Runtime Authentication → Session Login</strong>,
            then this app's users (who can only log in via <code>POST {app.base_path}/login</code>) will be managed here.
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <SectionHead
          title={`App Users (${users.length})`}
          action={!readonly ? <Btn size="sm" onClick={() => setShowAdd(true)}>+ Add User</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", background: "#f0f7ff", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#1e40af" }}>
          These users authenticate <strong>only</strong> against this app via <code>POST {app.base_path}/login</code>.
          They cannot log in to the admin dashboard, and dashboard admins cannot use their credentials here.
          <code>sub</code> is the identity bound into the session — it defaults to the username when not set (member-scoped apps set it to the member ID, e.g. MED2026...).
        </div>
        <div style={{ padding: 16 }}>
          {error && <ErrorBanner message={error} />}
          {loading ? <span style={{ fontSize: 12, color: C.muted }}>Loading…</span> : users.length === 0 ? (
            <p style={{ fontSize: 12, color: C.muted }}>No users yet — add the first one so the login endpoint can authenticate someone.</p>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px auto", gap: "0 10px", padding: "4px 8px", marginBottom: 4 }}>
                {["USERNAME", "EMAIL", "SUB (IDENTITY)", "STATUS", ""].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</span>
                ))}
              </div>
              {users.map(u => (
                <div key={u._id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 90px auto", gap: "0 10px", alignItems: "center", padding: "8px 8px", borderRadius: C.radius, border: `1px solid ${C.border}`, marginBottom: 4, background: u.is_active ? C.surface : C.bg }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: u.is_active ? C.text : C.muted }}>{u.display_name || u.username}</div>
                    <code style={{ fontSize: 11, color: C.muted }}>@{u.username}</code>
                  </div>
                  <span style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                  <code style={{ fontSize: 12, color: C.primary }}>{u.sub}</code>
                  <Badge text={u.is_active ? "active" : "disabled"} />
                  {!readonly && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn size="sm" variant="ghost" onClick={() => setResetUser(u)}>Reset PW</Btn>
                      <Btn size="sm" variant="ghost" onClick={async () => {
                        try { await api.put(`/__config/apps/${appId}/users/${u._id}`, { is_active: !u.is_active }); load(); }
                        catch (e) { alert(String(e)); }
                      }}>{u.is_active ? "Disable" : "Enable"}</Btn>
                      <button onClick={() => setDeleteUser(u)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }}>×</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {showAdd && <AddUserModal appId={appId} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); load(); }} />}
      {resetUser && <ResetPasswordModal appId={appId} user={resetUser} onClose={() => setResetUser(null)} onDone={() => { setResetUser(null); }} />}
      {deleteUser && (
        <Confirm
          danger
          message={`Delete user "${deleteUser.username}"? Their active sessions on this app will be revoked immediately.`}
          onConfirm={async () => {
            try { await api.del(`/__config/apps/${appId}/users/${deleteUser._id}`); setDeleteUser(null); load(); }
            catch (e) { alert(String(e)); }
          }}
          onCancel={() => setDeleteUser(null)}
        />
      )}
    </div>
  );
}

function AddUserModal({ appId, onClose, onCreated }: { appId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ username: "", email: "", password: "", sub: "", display_name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      await api.post(`/__config/apps/${appId}/users`, {
        username: form.username, email: form.email, password: form.password, sub: form.sub,
        ...(form.display_name ? { display_name: form.display_name } : {}),
      });
      onCreated();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal_ title="Add App User" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Username"><input style={inputStyle} value={form.username} onChange={set("username")} required autoFocus /></Field>
          <Field label="Display name"><input style={inputStyle} value={form.display_name} onChange={set("display_name")} placeholder="optional" /></Field>
        </div>
        <Field label="Email"><input type="email" style={inputStyle} value={form.email} onChange={set("email")} required /></Field>
        <Field label="Password" hint="At least 8 characters — shown to you once, stored as an argon2 hash">
          <input type="password" style={inputStyle} value={form.password} onChange={set("password")} required minLength={8} />
        </Field>
        <Field label="Sub (identity) — optional" hint="Bound into the session as the verified identity. Leave empty to use the username — e.g. MED202609070001 for member-scoped apps.">
          <input style={inputStyle} value={form.sub} onChange={set("sub")} placeholder="defaults to username" />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Creating…" : "Create User"}</Btn>
        </div>
      </form>
    </Modal_>
  );
}

function ResetPasswordModal({ appId, user, onClose, onDone }: { appId: string; user: AppUser; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      await api.put(`/__config/apps/${appId}/users/${user._id}/password`, { password });
      onDone();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal_ title={`Reset password — ${user.username}`} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <div style={{ padding: "8px 12px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
          All of this user's active sessions on this app will be revoked.
        </div>
        <Field label="New password" hint="At least 8 characters">
          <input type="password" style={inputStyle} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoFocus />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Reset Password"}</Btn>
        </div>
      </form>
    </Modal_>
  );
}

function Modal_(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Local minimal modal to avoid importing Modal with width constraints — matches app styling
  const { title, onClose, children } = props;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.surface, borderRadius: C.radius, border: `1px solid ${C.border}`, width: 480, maxHeight: "85vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: C.muted }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
