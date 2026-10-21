import { usePageSave } from "../../../components/PageSave";
import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { Organization, OrgAppearance } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";
import { useTheme } from "../../../theme/ThemeContext";
import type { ThemeChoice, ColorPalette } from "../../../theme/ThemeContext";

const THEMES:   Array<{ value: ThemeChoice;   label: string }> = [
  { value: "dark",   label: "Dark" },
  { value: "light",  label: "Light" },
  { value: "system", label: "Follow system" },
];
const PALETTES: Array<{ value: ColorPalette; label: string }> = [
  { value: "current",    label: "Default (Navy)" },
  { value: "coastal",    label: "Coastal" },
  { value: "monochrome", label: "Monochrome" },
  { value: "orchid",     label: "Orchid" },
];

export function OrganizationTab() {
  const { can } = useSession();
  const { choice, setChoice, palette, setPalette } = useTheme();
  const [org, setOrg] = useState<Organization | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [appearance, setAppearance] = useState<OrgAppearance>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<Organization>("/__config/admin/organization")
      .then(o => { setOrg(o); setName(o.name); setSlug(o.slug); setAppearance(o.appearance ?? {}); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const updated = await api.put<Organization>("/__config/admin/organization", { name, slug, appearance });
      setOrg(updated); setName(updated.name); setSlug(updated.slug); setAppearance(updated.appearance ?? {});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  function updateAppearance(patch: OrgAppearance) {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    // Apply live — feel the change instantly; persisted on Save
    if (patch.theme)   setChoice(patch.theme);
    if (patch.palette) setPalette(patch.palette);
  }

  usePageSave({name,slug,appearance},save,{enabled:can("manage:users"),ready:!loading && !!org,disabled:saving || !name.trim() || !slug.trim()});

  if (loading) return <Spinner />;

  return <Card><div className="ui-card__body">
    {error && <ErrorBanner message={error}/>}
    <div className="ui-formgrid">
      <Field label="Organization name" hint="Displayed in the dashboard header and response headers">
        <input className="ui-input" value={name} onChange={e=>setName(e.target.value)} disabled={!can("manage:users")}/>
      </Field>
      <Field label="Slug" hint="Used in URLs and system references. Lowercase, no spaces.">
        <input className="ui-input ui-input--mono" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"-"))} disabled={!can("manage:users")}/>
      </Field>
    </div>

    {/* ── Appearance ── */}
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
        Appearance — org default for every signed-in user
      </div>
      <div className="ui-formgrid">
        <Field label="Theme" hint="Applied to all users on sign-in; each browser mirrors it locally for instant load">
          <select className="ui-select" value={appearance.theme ?? choice} disabled={!can("manage:users")} onChange={e=>updateAppearance({ theme: e.target.value as ThemeChoice })}>
            {THEMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Palette" hint="Colour scheme applied across the dashboard">
          <select className="ui-select" value={appearance.palette ?? palette} disabled={!can("manage:users")} onChange={e=>updateAppearance({ palette: e.target.value as ColorPalette })}>
            {PALETTES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
      </div>
    </div>

    {org && <dl className="ui-kv" style={{marginTop:6}}>
      <dt>Organization ID</dt><dd><span className="ui-path">{org._id}</span></dd>
      <dt>Created</dt><dd className="ui-num">{new Date(org.created_at).toLocaleString()}</dd>
    </dl>}
  </div></Card>;
}
