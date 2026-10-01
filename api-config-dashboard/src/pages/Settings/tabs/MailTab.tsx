import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { ListResult, Secret, MailSender, MailRoute } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Badge, Confirm, Modal, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

/**
 * Org mail management — multiple named SMTP senders with purpose-based
 * routing. Each purpose (verification, …) maps to a sender; BYO credentials,
 * passwords in the Secrets vault. SMS shows placeholder status until a
 * partner/BYO provider integration lands.
 */

const PURPOSE_LABELS: Record<string, string> = {
  verification: "Account verification emails",
  otp: "Two-factor login codes (email OTP)",
};

export function MailTab() {
  const { can } = useSession();
  const readonly = !can("manage:users");
  const [senders, setSenders] = useState<MailSender[]>([]);
  const [routes, setRoutes] = useState<MailRoute[]>([]);
  const [purposes, setPurposes] = useState<string[]>(["verification"]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<MailSender | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteSender, setDeleteSender] = useState<MailSender | null>(null);
  const [testSender, setTestSender] = useState<MailSender | null>(null);

  async function load() {
    setLoading(true); setError("");
    try {
      const [s, st, sec] = await Promise.all([
        api.get<ListResult<MailSender>>("/__config/admin/mail-config/senders"),
        api.get<{ purposes: string[]; routes: MailRoute[] }>("/__config/admin/mail-config/status"),
        api.get<ListResult<Secret>>("/__config/admin/secrets").catch(() => ({ results: [] as Secret[], count: 0 })),
      ]);
      setSenders(s.results);
      setRoutes(st.routes);
      setPurposes(st.purposes);
      setSecrets(sec.results);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const routedIds = new Set(routes.map(r => r.sender_id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <SectionHead
          title={`Mail senders (${senders.length})`}
          action={!readonly ? <Btn size="sm" onClick={() => setShowCreate(true)}>+ Add Sender</Btn> : undefined}
        />
        <div style={{ padding: 16 }}>
          <p style={{ fontSize: 12, color: C.muted, margin: "0 0 12px" }}>
            Configure as many SMTP senders as you need (Gmail app password, Amazon SES, Postmark, anything SMTP)
            and route each purpose to a different one. Passwords live in the <strong>Secrets</strong> vault —
            only the reference is stored.
          </p>
          {error && <ErrorBanner message={error} />}
          {loading ? <span style={{ fontSize: 12, color: C.muted }}>Loading…</span> : senders.length === 0 ? (
            <p style={{ fontSize: 12, color: C.muted }}>No senders yet — add one to enable verification emails.</p>
          ) : (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr 110px auto", gap: "0 10px", padding: "4px 8px", marginBottom: 4 }}>
                {["NAME", "HOST", "FROM", "STATUS", ""].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</span>
                ))}
              </div>
              {senders.map(s => (
                <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1.4fr 110px auto", gap: "0 10px", alignItems: "center", padding: "8px 8px", borderRadius: C.radius, border: `1px solid ${routedIds.has(s.id) ? C.primary : C.border}`, marginBottom: 4, background: s.is_active ? C.surface : C.bg }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {s.name}
                    {routedIds.has(s.id) && <span style={{ marginLeft: 6 }}><Badge text="routed" /></span>}
                  </div>
                  <code style={{ fontSize: 11 }}>{s.host}:{s.port}{s.secure ? " (SSL)" : ""}</code>
                  <span style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis" }}>{s.from_address}</span>
                  <Badge text={s.is_active ? "active" : "inactive"} />
                  {!readonly && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn size="sm" variant="ghost" onClick={() => setTestSender(s)}>Test</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Btn>
                      <button onClick={() => setDeleteSender(s)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }}>×</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SectionHead title="Routing — which sender handles which purpose" />
        <div style={{ padding: 16 }}>
          {purposes.map(p => (
            <PurposeRoute key={p} purpose={p} label={PURPOSE_LABELS[p] ?? p}
              senders={senders} routes={routes} readonly={readonly} onChanged={load} />
          ))}
        </div>
      </Card>

      <Card>
        <SectionHead title="SMS / Phone OTP" />
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Badge text="not configured" />
            <span style={{ fontSize: 12, color: C.muted }}>Phone verification is feature-ready but has no provider wired yet.</span>
          </div>
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
            SMS provider integrations (bring-your-own credentials, or purchased through us via our
            partner program) are coming. Phone verification endpoints respond 501 until one is configured.
          </p>
        </div>
      </Card>

      {(showCreate || editing) && (
        <SenderModal
          sender={editing ?? undefined}
          secrets={secrets}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onDone={() => { setShowCreate(false); setEditing(null); load(); }}
        />
      )}
      {testSender && (
        <TestSendModal sender={testSender} onClose={() => setTestSender(null)} />
      )}
      {deleteSender && (
        <Confirm
          danger
          message={`Delete sender "${deleteSender.name}"? Senders that are routed must be reassigned first.`}
          onConfirm={async () => {
            try { await api.del(`/__config/admin/mail-config/senders/${deleteSender.id}`); setDeleteSender(null); load(); }
            catch (e) { setError(String(e)); setDeleteSender(null); }
          }}
          onCancel={() => setDeleteSender(null)}
        />
      )}
    </div>
  );
}

function PurposeRoute({ purpose, label, senders, routes, readonly, onChanged }: {
  purpose: string; label: string; senders: MailSender[]; routes: MailRoute[];
  readonly: boolean; onChanged: () => void;
}) {
  const route = routes.find(r => r.purpose === purpose);
  const [senderId, setSenderId] = useState(route?.sender_id ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSenderId(route?.sender_id ?? ""); }, [route?.sender_id]);

  async function save() {
    setSaving(true);
    try {
      if (senderId) await api.put("/__config/admin/mail-config/routes", { purpose, sender_id: senderId });
      else await api.del(`/__config/admin/mail-config/routes?purpose=${encodeURIComponent(purpose)}`);
      onChanged();
    } catch (e) { alert(String(e)); } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{label}</span>
      <select style={{ ...inputStyle, flex: 1 }} value={senderId} onChange={e => setSenderId(e.target.value)} disabled={readonly}>
        <option value="">— not routed (sending disabled) —</option>
        {senders.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name} ({s.from_address})</option>)}
      </select>
      <Btn size="sm" onClick={save} disabled={saving || readonly || senderId === (route?.sender_id ?? "")}>{saving ? "Saving…" : "Set"}</Btn>
    </div>
  );
}

function SenderModal({ sender, secrets, onClose, onDone }: {
  sender?: MailSender; secrets: Secret[]; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: sender?.name ?? "",
    host: sender?.host ?? "",
    port: String(sender?.port ?? 587),
    secure: sender?.secure ? "ssl" : "starttls",
    username: sender?.username ?? "",
    password_ref: "",
    from_address: sender?.from_address ?? "",
    from_name: sender?.from_name ?? "",
    is_active: sender?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    const payload: Record<string, unknown> = {
      name: form.name, host: form.host, port: Number(form.port), secure: form.secure === "ssl",
      username: form.username, from_address: form.from_address, from_name: form.from_name,
      is_active: form.is_active,
    };
    if (form.password_ref) payload["password_ref"] = form.password_ref;
    try {
      if (sender) await api.put(`/__config/admin/mail-config/senders/${sender.id}`, payload);
      else await api.post("/__config/admin/mail-config/senders", payload);
      onDone();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title={sender ? `Edit sender — ${sender.name}` : "Add mail sender"} onClose={onClose} width={540}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Name" hint="e.g. Gmail notifications, SES transactional"><input style={inputStyle} value={form.name} onChange={set("name")} required autoFocus /></Field>
          <Field label="From name"><input style={inputStyle} value={form.from_name} onChange={set("from_name")} placeholder="Acme Portal" /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 90px 1fr", gap: "0 12px" }}>
          <Field label="SMTP host"><input style={inputStyle} value={form.host} onChange={set("host")} placeholder="smtp.gmail.com" required /></Field>
          <Field label="Port"><input style={inputStyle} type="number" value={form.port} onChange={set("port")} /></Field>
          <Field label="TLS mode">
            <select style={inputStyle} value={form.secure} onChange={set("secure")}>
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS (465)</option>
            </select>
          </Field>
        </div>
        <Field label="Username" hint="Usually the sending email address"><input style={inputStyle} value={form.username} onChange={set("username")} placeholder="notifications@yourdomain.com" /></Field>
        <Field label="Password (from vault)" hint={sender?.password_set ? "A password is stored. Pick a different secret to replace it." : "Create the secret under Admin → Secrets, then pick it here."}>
          <select style={inputStyle} value={form.password_ref} onChange={set("password_ref")}>
            <option value="">{sender?.password_set ? "— keep stored password —" : "— none —"}</option>
            {secrets.map(s => <option key={s._id} value={s._id}>🔒 {s.name}</option>)}
          </select>
        </Field>
        <Field label="From address"><input type="email" style={inputStyle} value={form.from_address} onChange={set("from_address")} placeholder="notifications@yourdomain.com" required /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "8px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
          Active
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : sender ? "Save" : "Create"}</Btn>
        </div>
      </form>
    </Modal>
  );
}

function TestSendModal({ sender, onClose }: { sender: MailSender; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function send(ev: React.FormEvent) {
    ev.preventDefault(); setSending(true); setError(""); setNotice("");
    try {
      const r = await api.post<{ sender: string }>("/__config/admin/mail-config/test", { to, sender_id: sender.id });
      setNotice(`Test email sent via "${r.sender}" to ${to}`);
    } catch (e) { setError(String(e)); } finally { setSending(false); }
  }

  return (
    <Modal title={`Send test — ${sender.name}`} onClose={onClose}>
      <form onSubmit={send}>
        {error && <ErrorBanner message={error} />}
        {notice && <div style={{ padding: "8px 12px", background: "var(--success-background)", borderRadius: C.radius, border: "1px solid var(--success)", fontSize: 12, color: "var(--success)", marginBottom: 12 }}>{notice}</div>}
        <Field label="To"><input type="email" style={inputStyle} value={to} onChange={e => setTo(e.target.value)} placeholder="you@example.com" required autoFocus /></Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Close</Btn>
          <Btn type="submit" disabled={sending || !to}>{sending ? "Sending…" : "Send test"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
