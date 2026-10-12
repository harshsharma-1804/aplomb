import { usePageSave } from "../../../components/PageSave";
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
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  usePageSave({name,slug},save,{enabled:can("manage:users"),ready:!loading && !!org,disabled:saving || !name.trim() || !slug.trim()});

  if (loading) return <Spinner />;

  return <Card><div className="ui-card__body">{error && <ErrorBanner message={error}/>}<div className="ui-formgrid"><Field label="Organization name" hint="Displayed in the dashboard header and response headers"><input className="ui-input" value={name} onChange={e=>setName(e.target.value)} disabled={!can("manage:users")}/></Field><Field label="Slug" hint="Used in URLs and system references. Lowercase, no spaces."><input className="ui-input ui-input--mono" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"-"))} disabled={!can("manage:users")}/></Field></div>{org && <dl className="ui-kv" style={{marginTop:6}}><dt>Organization ID</dt><dd><span className="ui-path">{org._id}</span></dd><dt>Created</dt><dd className="ui-num">{new Date(org.created_at).toLocaleString()}</dd></dl>}</div></Card>;
}
