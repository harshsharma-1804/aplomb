import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { AiBot, AiProvider, App, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, C, inputStyle } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function BindingsTab({ bot, onUpdated, readonly }: Props) {
  const [appIds, setAppIds]           = useState<string[]>(bot.allowed_app_ids ?? []);
  const [providerIds, setProviderIds] = useState<string[]>(bot.allowed_provider_ids ?? []);
  const [apps, setApps]               = useState<App[]>([]);
  const [providers, setProviders]     = useState<AiProvider[]>([]);
  const [allBots, setAllBots]         = useState<AiBot[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");
  const [saved, setSaved]             = useState(false);

  // Apps already assigned to other bots (app → bot is 1:1)
  const takenAppIds = new Set(
    allBots
      .filter(b => b._id !== bot._id)
      .flatMap(b => b.allowed_app_ids)
  );

  useEffect(() => {
    Promise.all([
      api.get<ListResult<App>>("/__config/apps"),
      api.get<{ results: AiProvider[] }>("/__config/admin/ai/providers"),
      api.get<{ results: AiBot[] }>("/__config/admin/ai/bots"),
    ]).then(([a, p, b]) => {
      setApps(a.results.filter(app => app.ai_expose && app.status === "active"));
      setProviders(p.results);
      setAllBots(b.results);
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { allowed_app_ids: appIds, allowed_provider_ids: providerIds });
      onUpdated(d);
      setSaved(true);
    } catch (e: any) {
      if (String(e).includes('APP_ALREADY_ASSIGNED') || String(e).includes('already assigned to bot')) {
        setError(String(e).replace('Error: ', ''));
      } else {
        setError(String(e));
      }
    }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <div style={{ padding: "8px 12px", background: "#fff8e1", border: "1px solid #fcd34d", borderRadius: C.radius, fontSize: 12, color: "#92400e" }}>
        Deny-by-default: empty lists = no access. Assign apps and providers to enable the bot.
      </div>

      {/* Allowed Apps */}
      <Card>
        <SectionHead
          title={`Allowed Apps (${appIds.length} assigned)`}
          action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div style={{ padding: 16 }}>
          <PickerSection
            placeholder={apps.length === 0 ? "No AI-exposed active apps — enable 'AI Exposure' on an app first" : "+ Add app…"}
            options={apps.filter(a => !appIds.includes(a._id) && !takenAppIds.has(a._id)).map(a => ({ value: a._id, label: `${a.name} (${a.base_path})` }))}
            selected={appIds}
            onAdd={id => { setAppIds([...appIds, id]); setSaved(false); }}
            onRemove={id => { setAppIds(appIds.filter(x => x !== id)); setSaved(false); }}
            disabled={readonly}
            emptyText="No apps assigned — this bot cannot call any endpoints."
            renderMeta={id => { const a = apps.find(x => x._id === id); return a ? <code style={{ fontSize: 11, color: C.muted }}>{a.base_path}</code> : null; }}
          />
        </div>
      </Card>

      {/* Allowed Providers */}
      <Card>
        <SectionHead
          title={`Allowed LLM Providers (${providerIds.length} assigned)`}
          action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
          The first active provider in this list is used for the chat agent. Deactivating a provider falls through to the next.
        </div>
        <div style={{ padding: 16 }}>
          <PickerSection
            placeholder={providers.length === 0 ? "No providers configured — add one in Settings → AI Providers" : "+ Add provider…"}
            options={providers.filter(p => !providerIds.includes(p._id)).map(p => ({ value: p._id, label: `${p.name} · ${p.model}` }))}
            selected={providerIds}
            onAdd={id => { setProviderIds([...providerIds, id]); setSaved(false); }}
            onRemove={id => { setProviderIds(providerIds.filter(x => x !== id)); setSaved(false); }}
            disabled={readonly}
            emptyText="No providers assigned — this bot cannot chat until a provider is assigned."
            renderMeta={id => { const p = providers.find(x => x._id === id); return p ? <code style={{ fontSize: 11, color: C.muted }}>{p.base_url} · {p.model}</code> : null; }}
          />
        </div>
      </Card>
    </div>
  );
}

function PickerSection({ placeholder, options, selected, onAdd, onRemove, disabled, emptyText, renderMeta }: {
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
  emptyText: React.ReactNode;
  renderMeta?: (id: string) => React.ReactNode;
}) {
  const noOptions = options.length === 0;
  return (
    <div>
      <select
        value=""
        disabled={disabled || noOptions}
        onChange={e => { if (e.target.value) onAdd(e.target.value); }}
        style={{ ...inputStyle, marginBottom: 8, color: noOptions ? C.muted : C.text, cursor: (disabled || noOptions) ? "not-allowed" : "pointer" }}
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.surface, minHeight: 60, maxHeight: 200, overflowY: "auto", padding: 6 }}>
        {selected.length === 0 && (
          <div style={{ padding: "12px 8px", fontSize: 12, color: C.muted, textAlign: "center" }}>{emptyText}</div>
        )}
        {selected.map(id => (
          <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", marginBottom: 4, border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.bg }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {options.find(o => o.value === id)?.label.split(" (")[0] ?? id}
              </span>
              {renderMeta?.(id)}
            </div>
            {!disabled && (
              <button
                onClick={() => onRemove(id)}
                style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 13, lineHeight: 1, cursor: "pointer" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.danger; (e.currentTarget as HTMLButtonElement).style.borderColor = C.danger; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.muted; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
              >×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
