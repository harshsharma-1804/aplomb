import { useState, useEffect, useCallback } from "react";
import { api } from "../../../api/client";
import type { AppUser, AppSessionSummary, IdentityProvider, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Confirm, Badge, Modal, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

/**
 * Per-app gateway-auth users (AppScopedSessions-9).
 * These users can ONLY log in to this app via POST {base_path}/login —
 * they are fully disjoint from dashboard admin users.
 */
export function UsersTab({ appId, app }: { appId: string; app: { base_path: string; session_method?: string; auth_mode?: string } }) {
  const { can } = useSession();
  const readonly = !can("manage:apps");
  const sessionOn = (app.auth_mode ?? "bearer") !== "bearer";
  const gatewayOn = sessionOn && ["gateway", "both"].includes(app.session_method ?? "both");

  const [users, setUsers] = useState<AppUser[]>([]);
  const [providers, setProviders] = useState<IdentityProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [resetUser, setResetUser] = useState<AppUser | null>(null);
  const [profileUser, setProfileUser] = useState<AppUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await api.get<ListResult<AppUser>>(`/__config/apps/${appId}/users`);
      setUsers(d.results);
      api.get<ListResult<IdentityProvider>>("/__config/admin/identity-providers").then(p => setProviders(p.results)).catch(() => {});
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [appId]);

  useEffect(() => { load(); }, [load]);

  if (!sessionOn) {
    return (
      <Card>
        <SectionHead title="App Users" />
        <div style={{ padding: 16 }}>
          <div style={{ padding: "10px 14px", background: "var(--selection)", borderRadius: C.radius, border: "1px solid var(--border)", fontSize: 12, color: "var(--primary)" }}>
            Session auth is not enabled for this app. Turn it on in <strong>Settings → Runtime Authentication</strong> —
            this directory holds the app's gateway users (password login) as well as identity-provisioned users.
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
          action={!readonly && gatewayOn ? <Btn size="sm" onClick={() => setShowAdd(true)}>+ Add User</Btn> : undefined}
        />
          <div style={{ padding: "10px 16px", background: "var(--selection)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--primary)" }}>
            These users authenticate <strong>only</strong> against this app — via <code>POST {app.base_path}/login</code> (gateway) or their identity provider (brokered redirect).
            They cannot log in to the admin dashboard, and dashboard admins cannot use their credentials here.
            Each user's login method is sticky: gateway users sign in with credentials, identity users sign in via their provider — they never cross over.
          </div>
        <div style={{ padding: 16 }}>
          {error && <ErrorBanner message={error} />}
          {loading ? <span style={{ fontSize: 12, color: C.muted }}>Loading…</span> : users.length === 0 ? (
            <p style={{ fontSize: 12, color: C.muted }}>
              No users yet — {gatewayOn
                ? "add the first gateway user, or they'll appear here after their first identity-provider login."
                : "users appear here automatically after their first identity-provider login."}
            </p>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1fr 80px 90px 1fr 70px 90px auto", gap: "0 10px", padding: "4px 8px", marginBottom: 4 }}>
                {["USERNAME", "EMAIL", "SUB (IDENTITY)", "METHOD", "VERIFIED", "LAST LOGIN", "2FA", "STATUS", ""].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</span>
                ))}
              </div>
              {users.map(u => (
                <div key={u.id}
                  onClick={() => setProfileUser(u)}
                  title="View profile"
                  style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1fr 80px 90px 1fr 70px 90px auto", gap: "0 10px", alignItems: "center", padding: "8px 8px", borderRadius: C.radius, border: `1px solid ${C.border}`, marginBottom: 4, background: u.is_active ? C.surface : C.bg, cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = C.primary)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: u.is_active ? C.text : C.muted }}>{u.display_name || u.username}</div>
                    <code style={{ fontSize: 11, color: C.muted }}>@{u.username}</code>
                  </div>
                  <span style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                  <code style={{ fontSize: 12, color: C.primary }}>{u.sub}</code>
                  <Badge text={u.auth_method === "identity" ? "🌐 IdP" : "🔑 gw"} />
                  <Badge text={u.email_verified ? "verified" : "unverified"} />
                  <span style={{ fontSize: 11, color: C.muted }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "—"}</span>
                  <TwoFaBadge user={u} />
                  <Badge text={u.is_locked ? "🔒 locked" : u.is_active ? "active" : "disabled"} />
                  {!readonly && (
                    <div style={{ display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                      {u.auth_method !== "identity" && <Btn size="sm" variant="ghost" onClick={() => setResetUser(u)}>Reset PW</Btn>}
                      <Btn size="sm" variant="ghost" onClick={async () => {
                        try { await api.put(`/__config/apps/${appId}/users/${u.id}`, { is_active: !u.is_active }); load(); }
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
      {profileUser && (
        <UserProfileModal
          appId={appId}
          user={profileUser}
          providers={providers}
          readonly={readonly}
          onClose={() => setProfileUser(null)}
          onRevoked={load}
        />
      )}
      {resetUser && <ResetPasswordModal appId={appId} user={resetUser} onClose={() => setResetUser(null)} onDone={() => { setResetUser(null); }} />}
      {deleteUser && (
        <Confirm
          danger
          message={`Delete user "${deleteUser.username}"? Their active sessions on this app will be revoked immediately.`}
          onConfirm={async () => {
            try { await api.del(`/__config/apps/${appId}/users/${deleteUser.id}`); setDeleteUser(null); load(); }
            catch (e) { alert(String(e)); }
          }}
          onCancel={() => setDeleteUser(null)}
        />
      )}
    </div>
  );
}

function TwoFaBadge({ user }: { user: AppUser }) {
  if (user.auth_method === "identity") return <span style={{ fontSize: 11, color: C.muted }}>—</span>;
  if (user.twofa_enrolled) return <Badge text={user.twofa_method === "email_otp" ? "🔐 OTP" : "🔐 TOTP"} />;
  if (user.twofa_status === "enforced") return <Badge text="⚠ required" />;
  return <span style={{ fontSize: 11, color: C.muted }}>off</span>;
}

function UserProfileModal({ appId, user, providers, readonly, onClose, onRevoked }: {
  appId: string; user: AppUser; providers: IdentityProvider[]; readonly: boolean;
  onClose: () => void; onRevoked: () => void;
}) {
  const [detail, setDetail] = useState<AppUser>(user);
  const [sessions, setSessions] = useState<AppSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    api.get<AppUser>(`/__config/apps/${appId}/users/${user.id}`).then(setDetail).catch(() => {});
    api.get<ListResult<AppSessionSummary>>(`/__config/apps/${appId}/users/${user.id}/sessions`)
      .then(d => setSessions(d.results))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, [appId, user.id]);

  async function revoke(sessionId: string) {
    try {
      await api.del(`/__config/apps/${appId}/sessions/${sessionId}`);
      const d = await api.get<ListResult<AppSessionSummary>>(`/__config/apps/${appId}/users/${user.id}/sessions`);
      setSessions(d.results);
      onRevoked();
    } catch (e) { setError(String(e)); }
  }

  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard unavailable */ }
  }

  const provider = providers.find(p => p._id === detail.identity_provider_id);
  const initial = (detail.display_name || detail.username || detail.email || "?").charAt(0).toUpperCase();

  const fmt = (v: string | null) => v ? new Date(v).toLocaleString() : "—";

  const Row = ({ label, value, mono, copyable }: { label: string; value: React.ReactNode; mono?: boolean; copyable?: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, width: 120, flexShrink: 0, textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</span>
      <span style={{ fontSize: 12.5, flex: 1, wordBreak: "break-all", fontFamily: mono ? "monospace" : undefined }}>{value}</span>
      {copyable && (
        <Btn size="sm" variant="ghost" onClick={() => copy(label, copyable)}>{copied === label ? "Copied ✓" : "Copy"}</Btn>
      )}
    </div>
  );

  return (
    <Modal title="User profile" onClose={onClose} width={620}>
      {error && <ErrorBanner message={error} />}

      {/* ── Header card ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: C.radius, background: C.bg, border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: detail.is_active ? C.primary : C.muted, color: C.primaryText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, flexShrink: 0 }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{detail.display_name || detail.username}</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>{detail.email}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <Badge text={detail.auth_method === "identity" ? "🌐 Identity" : "🔑 Gateway"} />
            <Badge text={detail.email_verified ? "verified" : "unverified"} />
            <Badge text={detail.is_active ? "active" : "disabled"} />
          </div>
        </div>
      </div>

      {/* ── Identity details ────────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>Account</div>
      <Row label="Username" value={`@${detail.username}`} mono copyable={detail.username} />
      <Row label="Display name" value={detail.display_name || "—"} />
      <Row label="Email" value={detail.email} copyable={detail.email} />
      <Row label="Sub (identity)" value={detail.sub} mono copyable={detail.sub} />
      <Row label="Login method" value={detail.auth_method === "identity" ? "🌐 Identity provider" : "🔑 Gateway (username + password)"} />
      {detail.auth_method === "identity" && (
        <>
          <Row label="Provider" value={provider ? `${provider.name}` : detail.identity_provider_id ?? "—"} />
          <Row label="Provider sub" value={detail.idp_sub ?? "—"} mono copyable={detail.idp_sub ?? undefined} />
        </>
      )}
      {detail.auth_method === "gateway" && detail.identity_provider_id && (
        <>
          <Row label="Linked provider" value={provider ? provider.name : detail.identity_provider_id} />
          <Row label="Linked provider sub" value={detail.idp_sub ?? "—"} mono copyable={detail.idp_sub ?? undefined} />
        </>
      )}
      <Row label="Email verified" value={detail.email_verified ? "✓ yes" : "✗ no"} />

      {/* ── Two-factor (gateway users only) ─────────────────────────────────── */}
      {detail.auth_method === "gateway" && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", margin: "14px 0 4px" }}>Two-factor authentication</div>
          <Row
            label="Status"
            value={
              detail.twofa_enrolled
                ? `🔐 Enabled — ${detail.twofa_method === "email_otp" ? "email OTP codes" : "authenticator app (TOTP)"}`
                : detail.twofa_status === "enforced"
                  ? "⚠ Required — user must enroll at next login"
                  : "Off — password only"
            }
          />
          {!readonly && (
            <div style={{ display: "flex", gap: 8, margin: "10px 0 4px" }}>
              {detail.twofa_status !== "enforced" && (
                <Btn size="sm" onClick={async () => {
                  try { setDetail(await api.put<AppUser>(`/__config/apps/${appId}/users/${detail.id}/2fa`, { action: "enforce" })); }
                  catch (e) { setError(String(e)); }
                }}>Require 2FA</Btn>
              )}
              {detail.twofa_enrolled && (
                <Btn size="sm" variant="ghost" onClick={async () => {
                  try { setDetail(await api.put<AppUser>(`/__config/apps/${appId}/users/${detail.id}/2fa`, { action: "reset" })); }
                  catch (e) { setError(String(e)); }
                }}>Reset (re-enroll)</Btn>
              )}
              {(detail.twofa_status !== "off" || detail.twofa_enrolled) && (
                <Btn size="sm" variant="danger" onClick={async () => {
                  try { setDetail(await api.put<AppUser>(`/__config/apps/${appId}/users/${detail.id}/2fa`, { action: "disable" })); }
                  catch (e) { setError(String(e)); }
                }}>Disable</Btn>
              )}
            </div>
          )}
          <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0" }}>
            Require = the user must enroll at their next login (their active sessions are revoked).
            Reset = wipes the enrollment but keeps the requirement. Disable = password-only again.
          </p>
        </>
      )}

      {/* ── Timestamps ──────────────────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", margin: "14px 0 4px" }}>Activity</div>
      <Row label="Last login" value={fmt(detail.last_login_at)} />
      {detail.is_locked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", margin: "8px 0" }}>
          <span style={{ fontSize: 12, color: "#92400e", flex: 1 }}>
            🔒 Account locked until {detail.locked_until ? new Date(detail.locked_until).toLocaleString() : "—"} ({detail.failed_login_attempts} failed attempts)
          </span>
          {!readonly && (
            <Btn size="sm" onClick={async () => {
              try {
                const updated = await api.put<AppUser>(`/__config/apps/${appId}/users/${detail.id}/unlock`, {});
                setDetail(updated);
              } catch (e) { setError(String(e)); }
            }}>Unlock</Btn>
          )}
        </div>
      )}
      <Row label="Created" value={fmt(detail.created_at)} />
      <Row label="Updated" value={fmt(detail.updated_at)} />
      <Row label="User ID" value={detail.id} mono copyable={detail.id} />

      {/* ── Active sessions ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0 6px" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
          Active sessions ({sessions.length})
        </span>
      </div>
      {loadingSessions ? (
        <p style={{ fontSize: 12, color: C.muted }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: 12, color: C.muted }}>No active sessions on this app right now.</p>
      ) : (
        sessions.map(s => (
          <div key={s.id} style={{ padding: "8px 10px", borderRadius: C.radius, border: `1px solid ${C.border}`, marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.device_label}{s.is_current && <span style={{ color: C.primary }}> · this device</span>}</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                {s.last_seen_ip ?? "unknown IP"} · last active {fmt(s.last_active_at)} · idle expires {fmt(s.idle_expires_at)}
              </div>
            </div>
            <Btn size="sm" variant="danger" onClick={() => revoke(s.id)}>Revoke</Btn>
          </div>
        ))
      )}
    </Modal>
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
      await api.put(`/__config/apps/${appId}/users/${user.id}/password`, { password });
      onDone();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal_ title={`Reset password — ${user.username}`} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <div style={{ padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 12 }}>
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
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
