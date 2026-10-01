import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { Organization } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

export function OrganizationTab() {
  const { can } = useSession();
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<Organization>("/__config/admin/organization")
      .then(o => { setOrg(o); setName(o.name); setSlug(o.slug); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const updated = await api.put<Organization>("/__config/admin/organization", { name, slug });
      setOrg(updated); setName(updated.name); setSlug(updated.slug);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  if (loading) return <Spinner />;

  return (
    <Card>
      <SectionHead
        title="Organization"
        action={can("manage:users") ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn> : undefined}
      />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}
        {saved && <div style={{ padding: "8px 12px", background: "var(--success-background)", borderRadius: C.radius, color: "var(--success)", fontSize: 12, marginBottom: 12 }}>✓ Saved successfully</div>}

        <Field label="Organization Name" hint="Displayed in the dashboard header and response headers">
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} disabled={!can("manage:users")} />
        </Field>
        <Field label="Slug" hint="Used in URLs and system references. Lowercase, no spaces.">
          <input style={inputStyle} value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} disabled={!can("manage:users")} />
        </Field>

        {org && (
          <div style={{ marginTop: 16, padding: "10px 12px", background: C.bg, borderRadius: C.radius, border: `1px solid ${C.border}`, fontSize: 12, color: C.muted }}>
            <div>Organization ID: <code style={{ color: C.text }}>{org._id}</code></div>
            <div style={{ marginTop: 4 }}>Created: {new Date(org.created_at).toLocaleString()}</div>
          </div>
        )}
      </div>
    </Card>
  );
}
