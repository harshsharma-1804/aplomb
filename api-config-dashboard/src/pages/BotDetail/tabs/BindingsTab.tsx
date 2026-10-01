import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { AiBot, AiProvider, App, AppPermission, AppPermissionsMap, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, C, inputStyle } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function BindingsTab({ bot, onUpdated, readonly }: Props) {
  const [perms, setPerms]             = useState<AppPermissionsMap>(bot.app_permissions ?? {});
  const [providerIds, setProviderIds] = useState<string[]>(bot.allowed_provider_ids ?? []);
  const [apps, setApps]               = useState<App[]>([]);
  const [providers, setProviders]     = useState<AiProvider[]>([]);
  const [allBots, setAllBots]         = useState<AiBot[]>([]);
  const [providerSaving, setProviderSaving] = useState(false);
  const [error, setError]             = useState("");
  const [providerSaved, setProviderSaved] = useState(false);

  // Apps already assigned to OTHER bots (1-app:1-bot constraint)
  const takenAppIds = new Set(
    allBots.filter(b => b._id !== bot._id).flatMap(b => Object.keys(b.app_permissions ?? {}))
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

  // Immediate permission toggle for a single app
  async function togglePerm(appId: string, field: "read" | "write", val: boolean) {
    const current = perms[appId] ?? { read: true, write: true };
    const next: AppPermission = { ...current, [field]: val };
    setPerms(prev => ({ ...prev, [appId]: next }));
    setError("");
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}/apps/${appId}/permissions`, next);
      onUpdated(d);
      setPerms(d.app_permissions ?? {});
    } catch (e: any) {
      setError(String(e).replace("Error: ", ""));
      setPerms(prev => ({ ...prev, [appId]: current })); // revert
    }
  }

  // Add an app (default: read + write)
  async function addApp(appId: string) {
    setError("");
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}/apps/${appId}/permissions`, { read: true, write: true });
      onUpdated(d);
      setPerms(d.app_permissions ?? {});
    } catch (e: any) {
      setError(String(e).replace("Error: ", ""));
    }
  }

  // Remove an app
  async function removeApp(appId: string) {
    setError("");
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}/apps/${appId}/permissions`, { read: false, write: false });
      onUpdated(d);
      setPerms(d.app_permissions ?? {});
    } catch (e: any) {
      setError(String(e).replace("Error: ", ""));
    }
  }

  async function saveProviders() {
    setProviderSaving(true); setError(""); setProviderSaved(false);
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { allowed_provider_ids: providerIds });
      onUpdated(d);
      setProviderSaved(true);
    } catch (e: any) { setError(String(e)); }
    finally { setProviderSaving(false); }
  }

  const assignedApps = Object.entries(perms).filter(([, p]) => p.read || p.write);
  const unassignedApps = apps.filter(a => !perms[a._id] || (!perms[a._id]!.read && !perms[a._id]!.write));
  const availableToAdd = unassignedApps.filter(a => !takenAppIds.has(a._id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <div style={{ padding: "8px 12px", background: "var(--warning-background)", border: "1px solid var(--warning)", borderRadius: C.radius, fontSize: 12, color: "var(--warning)" }}>
        Deny-by-default: a bot can only access apps explicitly assigned here. Each app can only be assigned to one bot. Read = GET endpoints; Write = POST/PUT/PATCH/DELETE endpoints.
      </div>

      {/* ── Allowed Apps ──────────────────────────────────────────────────── */}
      <Card>
        <SectionHead title={`Allowed Apps (${assignedApps.length} assigned)`} />

        {/* Add app dropdown */}
        {!readonly && (
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
            <select
              value=""
              disabled={availableToAdd.length === 0}
              onChange={e => { if (e.target.value) addApp(e.target.value); }}
              style={{ ...inputStyle, cursor: availableToAdd.length === 0 ? "not-allowed" : "pointer", color: availableToAdd.length === 0 ? C.muted : C.text }}
            >
              <option value="">
                {availableToAdd.length === 0
                  ? apps.length === 0
                    ? "No AI-exposed active apps — enable 'AI Exposure' on an app first"
                    : "All AI-exposed apps are already assigned"
                  : "+ Add app…"}
              </option>
              {availableToAdd.map(a => <option key={a._id} value={a._id}>{a.name} ({a.base_path})</option>)}
            </select>
          </div>
        )}

        {/* Assigned apps table */}
        <div style={{ padding: "8px 16px" }}>
          {assignedApps.length === 0 && (
            <div style={{ padding: "16px 0", fontSize: 13, color: C.muted, textAlign: "center" }}>
              No apps assigned — this bot cannot call any endpoints.
            </div>
          )}

          {assignedApps.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${C.border}` }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>App</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", width: 70 }}>Read</th>
                  <th style={{ textAlign: "center", padding: "6px 8px", color: C.muted, fontWeight: 600, fontSize: 11, textTransform: "uppercase", width: 70 }}>Write</th>
                  {!readonly && <th style={{ width: 40 }} />}
                </tr>
              </thead>
              <tbody>
                {assignedApps.map(([appId, perm]) => {
                  const app = apps.find(a => a._id === appId);
                  return (
                    <tr key={appId} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px" }}>
                        <div style={{ fontWeight: 600 }}>{app?.name ?? appId}</div>
                        {app && <code style={{ fontSize: 11, color: C.muted }}>{app.base_path}</code>}
                      </td>
                      <td style={{ textAlign: "center", padding: "8px" }}>
                        <input
                          type="checkbox"
                          checked={perm.read}
                          onChange={e => !readonly && togglePerm(appId, "read", e.target.checked)}
                          disabled={readonly}
                          style={{ width: 15, height: 15, accentColor: C.primary, cursor: readonly ? "not-allowed" : "pointer" }}
                          title="Read: GET and HEAD endpoints"
                        />
                      </td>
                      <td style={{ textAlign: "center", padding: "8px" }}>
                        <input
                          type="checkbox"
                          checked={perm.write}
                          onChange={e => !readonly && togglePerm(appId, "write", e.target.checked)}
                          disabled={readonly}
                          style={{ width: 15, height: 15, accentColor: C.primary, cursor: readonly ? "not-allowed" : "pointer" }}
                          title="Write: POST, PUT, PATCH, DELETE endpoints"
                        />
                      </td>
                      {!readonly && (
                        <td style={{ textAlign: "center", padding: "8px" }}>
                          <button
                            onClick={() => removeApp(appId)}
                            style={{ width: 24, height: 24, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, cursor: "pointer", fontSize: 14 }}
                            title="Remove app"
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.danger; (e.currentTarget as HTMLButtonElement).style.borderColor = C.danger; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.muted; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
                          >×</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Allowed Providers ─────────────────────────────────────────────── */}
      <Card>
        <SectionHead
          title={`Allowed LLM Providers (${providerIds.length} assigned)`}
          action={!readonly ? <Btn size="sm" onClick={saveProviders} disabled={providerSaving}>{providerSaving ? "Saving…" : providerSaved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
          First active provider in this list is used. Deactivated providers are skipped.
        </div>
        <div style={{ padding: 16 }}>
          <select
            value=""
            disabled={providers.filter(p => !providerIds.includes(p._id)).length === 0}
            onChange={e => { if (e.target.value) { setProviderIds([...providerIds, e.target.value]); setProviderSaved(false); } }}
            style={{ ...inputStyle, marginBottom: 8, cursor: "pointer" }}
          >
            <option value="">
              {providers.filter(p => !providerIds.includes(p._id)).length === 0
                ? "No providers configured — add one in Settings → AI Providers"
                : "+ Add provider…"}
            </option>
            {providers.filter(p => !providerIds.includes(p._id)).map(p => (
              <option key={p._id} value={p._id}>{p.name} · {p.model}</option>
            ))}
          </select>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.surface, minHeight: 56, maxHeight: 200, overflowY: "auto", padding: 6 }}>
            {providerIds.length === 0 && (
              <div style={{ padding: "12px 8px", fontSize: 12, color: C.muted, textAlign: "center" }}>No providers assigned — this bot cannot chat.</div>
            )}
            {providerIds.map(pid => {
              const p = providers.find(x => x._id === pid);
              return (
                <div key={pid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", marginBottom: 4, border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.bg }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{p?.name ?? pid}</span>
                    {p && <code style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{p.model}</code>}
                    {p?.no_auth && <span style={{ fontSize: 10, background: "var(--success-background)", color: "var(--success)", border: "1px solid var(--success)", borderRadius: 4, padding: "1px 5px", marginLeft: 6 }}>local</span>}
                  </div>
                  {!readonly && (
                    <button onClick={() => { setProviderIds(providerIds.filter(x => x !== pid)); setProviderSaved(false); }} style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, cursor: "pointer", fontSize: 13 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.danger; (e.currentTarget as HTMLButtonElement).style.borderColor = C.danger; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.muted; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
