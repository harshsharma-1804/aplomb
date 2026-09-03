import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { IdentityProvider, ListResult } from "../../api/types";
import { Card, SectionHead, Table, Btn, Badge, Modal, Field, inputStyle, Spinner, ErrorBanner, Confirm, C } from "../../components";

export function ProvidersPage() {
  const [providers, setProviders] = useState<IdentityProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IdentityProvider | null>(null);

  async function load() {
    setLoading(true);
    try { const d = await api.get<ListResult<IdentityProvider>>("/__config/admin/identity-providers"); setProviders(d.results); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const cols = [
    { key: "name", label: "Name" },
    { key: "issuer", label: "Issuer", render: (v: unknown) => <code style={{ fontSize: 11 }}>{String(v)}</code> },
    { key: "algorithms", label: "Algorithms", render: (v: unknown) => String(v) },
    { key: "is_active", label: "Status", render: (v: unknown) => <Badge text={v ? "active" : "inactive"} /> },
    { key: "_id", label: "Actions", render: (_: unknown, row: Record<string, unknown>) => (
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" variant="danger" onClick={() => setDeleteTarget(row as unknown as IdentityProvider)}>Delete</Btn>
      </div>
    )},
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Identity Providers</h1>
          <p style={{ margin: "2px 0 0", color: C.muted, fontSize: 13 }}>OIDC providers whose tokens the orchestrator runtime will accept.</p>
        </div>
        <Btn onClick={() => setShowCreate(true)}>+ Add Provider</Btn>
      </div>
      {error && <ErrorBanner message={error} />}
      <Card>
        <SectionHead title={`${providers.length} provider${providers.length !== 1 ? "s" : ""}`} action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>} />
        {loading ? <Spinner /> : <Table cols={cols as Parameters<typeof Table>[0]["cols"]} rows={providers as unknown as Record<string, unknown>[]} />}
      </Card>
      {showCreate && <CreateProviderModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {deleteTarget && <Confirm danger message={`Delete provider "${deleteTarget.name}"? Apps referencing it will reject tokens from this issuer.`} onConfirm={async () => { await api.del(`/__config/admin/identity-providers/${deleteTarget._id}`); setDeleteTarget(null); load(); }} onCancel={() => setDeleteTarget(null)} />}
    </div>
  );
}

function CreateProviderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", issuer: "", jwks_uri: "", audience: "", algorithms: "RS256", clock_tolerance_sec: "60" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault(); setSaving(true); setError("");
    try {
      await api.post("/__config/admin/identity-providers", {
        name: form.name,
        issuer: form.issuer,
        jwks_uri: form.jwks_uri || null,
        audience: form.audience ? form.audience.split(",").map(s => s.trim()) : [],
        algorithms: form.algorithms.split(",").map(s => s.trim()),
        clock_tolerance_sec: Number(form.clock_tolerance_sec),
        claim_mappings: { subject: "sub", email: "email", roles: "groups" },
        is_active: true,
      });
      onCreated();
    } catch (e) { setError(String(e)); setSaving(false); }
  }

  return (
    <Modal title="Add Identity Provider" onClose={onClose} width={540}>
      <form onSubmit={submit}>
        {error && <ErrorBanner message={error} />}
        <Field label="Name"><input style={inputStyle} value={form.name} onChange={set("name")} placeholder="Okta Production" required /></Field>
        <Field label="Issuer URL" hint="e.g. https://company.okta.com/oauth2/default"><input style={inputStyle} value={form.issuer} onChange={set("issuer")} placeholder="https://..." required /></Field>
        <Field label="JWKS URI" hint="Leave blank to auto-discover from /.well-known/openid-configuration"><input style={inputStyle} value={form.jwks_uri} onChange={set("jwks_uri")} placeholder="https://.../.well-known/jwks.json" /></Field>
        <Field label="Audience" hint="Comma-separated. e.g. api://default"><input style={inputStyle} value={form.audience} onChange={set("audience")} placeholder="api://default" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Algorithms" hint="Comma-separated. e.g. RS256,ES256"><input style={inputStyle} value={form.algorithms} onChange={set("algorithms")} /></Field>
          <Field label="Clock Tolerance (sec)"><input style={inputStyle} type="number" value={form.clock_tolerance_sec} onChange={set("clock_tolerance_sec")} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn variant="ghost" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={saving}>{saving ? "Creating…" : "Create"}</Btn>
        </div>
      </form>
    </Modal>
  );
}
