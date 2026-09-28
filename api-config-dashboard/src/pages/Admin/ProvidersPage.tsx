import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { IdentityProvider, ListResult, Secret } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Modal, Field, inputStyle, Spinner, ErrorBanner, Confirm, C } from "../../components";

export function ProvidersPage() {
  const [providers, setProviders] = useState<IdentityProvider[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<IdentityProvider | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IdentityProvider | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api.get<ListResult<IdentityProvider>>("/__config/admin/identity-providers");
      setProviders(d.results);
      api.get<ListResult<Secret>>("/__config/admin/secrets").then(s => setSecrets(s.results)).catch(() => {});
    }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const cols = [
    { key: "name", label: "Name" },
    { key: "issuer", label: "Issuer", render: (v: unknown) => <code style={{ fontSize: 11 }}>{String(v)}</code> },
    { key: "client_id", label: "Brokered login", render: (v: unknown) =>
      v ? <Badge text="configured" /> : <span style={{ fontSize: 11, color: C.muted }}>token-verify only</span> },
    { key: "is_active", label: "Status", render: (v: unknown) => <Badge text={v ? "active" : "inactive"} /> },
    { key: "_id", label: "Actions", render: (_: unknown, row: Record<string, unknown>) => (
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="ghost" onClick={() => setEditing(row as unknown as IdentityProvider)}>Edit</Btn>
        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(row as unknown as IdentityProvider)}>Delete</Btn>
      </div>
    )},
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Identity Providers</h1>
          <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>
            OIDC providers whose tokens the runtime accepts — and, when a client ID + vault secret are set, full redirect login for apps.
          </p>
        </div>
        <Btn onClick={() => setShowCreate(true)}>+ Add Provider</Btn>
      </div>
      {error && <ErrorBanner message={error} />}
      <Card>
        <SectionHead title={`${providers.length} provider${providers.length !== 1 ? "s" : ""}`} action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>} />
        {loading ? <Spinner /> : <Table cols={cols as Parameters<typeof Table>[0]["cols"]} rows={providers as unknown as Record<string, unknown>[]} />}
      </Card>
      {showCreate && <ProviderModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); load(); }} secrets={secrets} />}
      {editing && <ProviderModal provider={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} secrets={secrets} />}
      {deleteTarget && <Confirm danger message={`Delete provider "${deleteTarget.name}"? Apps referencing it will reject tokens from this issuer.`} onConfirm={async () => { await api.del(`/__config/admin/identity-providers/${deleteTarget._id}`); setDeleteTarget(null); load(); }} onCancel={() => setDeleteTarget(null)} />}
    </div>
  );
}

function ProviderModal({ provider, onClose, onDone, secrets }: {
  provider?: IdentityProvider; onClose: () => void; onDone: () => void; secrets: Secret[];
}) {
  const [form, setForm] = useState({
    name: provider?.name ?? "",
    issuer: provider?.issuer ?? "",
    jwks_uri: provider?.jwks_uri ?? "",
    audience: (provider?.audience ?? []).join(", "),
    algorithms: (provider?.algorithms ?? ["RS256"]).join(","),
    clock_tolerance_sec: String(provider?.clock_tolerance_sec ?? 60),
    client_id: provider?.client_id ?? "",
    client_secret_ref: provider?.client_secret_ref ?? "",
    scopes: provider?.scopes ?? "openid email profile",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    const payload = {
      name: form.name,
      issuer: form.issuer,
      jwks_uri: form.jwks_uri || null,
      audience: form.audience ? form.audience.split(",").map(s => s.trim()) : [],
      algorithms: form.algorithms.split(",").map(s => s.trim()),
      clock_tolerance_sec: Number(form.clock_tolerance_sec),
      client_id: form.client_id.trim() || null,
      client_secret_ref: form.client_secret_ref || null,
      scopes: form.scopes.trim() || "openid email profile",
      claim_mappings: { subject: "sub", email: "email", roles: "groups" },
      is_active: true,
    };
    try {
      if (provider) await api.put(`/__config/admin/identity-providers/${provider._id}`, payload);
      else await api.post("/__config/admin/identity-providers", payload);
      onDone();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title={provider ? "Edit Identity Provider" : "Add Identity Provider"} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} placeholder="Google" required /></Field>
        <Field label="Issuer URL" hint="e.g. https://accounts.google.com or https://company.okta.com/oauth2/default"><input style={inputStyle} value={form.issuer} onChange={set("issuer")} placeholder="https://..." required /></Field>
        <Field label="JWKS URI" hint="Leave blank to auto-discover from /.well-known/openid-configuration"><input style={inputStyle} value={form.jwks_uri} onChange={set("jwks_uri")} placeholder="https://.../.well-known/jwks.json" /></Field>
        <Field label="Audience" hint="Comma-separated — for bearer-token verification. e.g. api://default"><input style={inputStyle} value={form.audience} onChange={set("audience")} placeholder="api://default" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Algorithms" hint="Comma-separated. e.g. RS256,ES256"><input style={inputStyle} value={form.algorithms} onChange={set("algorithms")} /></Field>
          <Field label="Clock Tolerance (sec)"><input style={inputStyle} type="number" value={form.clock_tolerance_sec} onChange={set("clock_tolerance_sec")} /></Field>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, margin: "12px 0 14px", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
            Brokered login (OAuth redirect)
          </div>
          <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
            Fill these to let apps start login at <code>{`{base_path}/auth/login/{providerId}`}</code> and land back authenticated.
            Register the callback URL <code>{`{orchestrator}{base_path}/auth/callback/{providerId}`}</code> at the provider.
          </p>
          <Field label="Client ID" hint="OAuth client ID from the provider console"><input style={inputStyle} value={form.client_id} onChange={set("client_id")} placeholder="1234567890.apps.googleusercontent.com" /></Field>
          <Field label="Client secret (from vault)" hint="Create the secret under Admin → Secrets, then pick it here. Never stored in provider config.">
            <select style={inputStyle} value={form.client_secret_ref} onChange={set("client_secret_ref")}>
              <option value="">— none —</option>
              {secrets.map(s => <option key={s._id} value={s._id}>🔒 {s.name}</option>)}
            </select>
          </Field>
          <Field label="Scopes" hint="Space-separated OIDC scopes"><input style={inputStyle} value={form.scopes} onChange={set("scopes")} placeholder="openid email profile" /></Field>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Saving…" : provider ? "Save" : "Create"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
