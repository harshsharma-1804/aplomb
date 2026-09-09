import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import type { App, AppEnvVar, ListResult, IdentityProvider, Secret } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, Badge, Confirm, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props {
  app: App;
  appId: string;
  onAppUpdated: (updated: App) => void;
  onDeleteApp: () => void;
  onCloneApp: () => void;
}

export function SettingsTab({ app, appId, onAppUpdated, onDeleteApp, onCloneApp }: Props) {
  const { can } = useSession();
  const readonly = !can("manage:apps");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <GeneralSection    app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />
      <AuthSection       app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />
      <AiExposeSection   app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />
      <EnvSection        app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />
      <QuickActionsSection app={app} appId={appId} onSaved={onAppUpdated} onDelete={onDeleteApp} onClone={onCloneApp} readonly={readonly} />
    </div>
  );
}

// ── Section 1: General ────────────────────────────────────────────────────────

function GeneralSection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [name, setName]           = useState(app.name);
  const [basePath, setBasePath]   = useState(app.base_path);
  const [description, setDescription] = useState(app.description);
  const [status, setStatus]       = useState(app.status);
  const [deprecatedAt, setDeprecatedAt] = useState(app.deprecated_at ?? "");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [pathTaken, setPathTaken] = useState(false);
  const [checking, setChecking]   = useState(false);

  const pathChanged = basePath !== app.base_path;

  const checkUnique = useCallback(async (path: string) => {
    if (!path || path === app.base_path) { setPathTaken(false); return; }
    setChecking(true);
    try {
      const d = await api.get<{ count: number; results: App[] }>(`/__config/apps?base_path=${encodeURIComponent(path)}`);
      setPathTaken(d.results.some(a => a._id !== app._id));
    } catch { setPathTaken(false); }
    finally { setChecking(false); }
  }, [app._id, app.base_path]);

  async function save() {
    if (pathTaken || checking) return;
    setSaving(true); setError("");
    try {
      const body: Record<string, unknown> = { name, base_path: basePath, description, status };
      if (status === "deprecated" && deprecatedAt) body["deprecated_at"] = deprecatedAt;
      if (status !== "deprecated") body["deprecated_at"] = null;
      const updated = await api.put<App>(`/__config/apps/${appId}`, body);
      onSaved(updated);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const pathHint = checking ? "Checking…"
    : pathTaken ? "⚠ Already taken by another app"
    : pathChanged && !checking ? "✓ Available"
    : "The URL prefix all endpoints under this app respond at";

  return (
    <Card>
      <SectionHead title="General" action={!readonly ? <Btn size="sm" onClick={save} disabled={saving || pathTaken || checking}>{saving ? "Saving…" : "Save"}</Btn> : undefined} />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label="App Name">
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} disabled={readonly} />
          </Field>
          <Field label="Base Path" hint={pathHint}>
            <input
              style={{ ...inputStyle, borderColor: pathTaken ? C.danger : pathChanged && !checking ? C.success : C.border }}
              value={basePath}
              onChange={e => setBasePath(e.target.value)}
              onBlur={() => checkUnique(basePath)}
              disabled={readonly}
            />
          </Field>
        </div>

        {pathChanged && (
          <div style={{ padding: "8px 12px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
            <strong>Note:</strong> Changing the base path takes effect immediately. Clients calling <code>{app.base_path}</code> will receive 404 until they update to <code>{basePath}</code>.
          </div>
        )}

        <Field label="Description">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56 }} value={description} onChange={e => setDescription(e.target.value)} disabled={readonly} />
        </Field>

        <Field label="Status">
          <div style={{ display: "flex", gap: 8 }}>
            {(["draft", "active", "deprecated"] as const).map(s => (
              <button key={s} onClick={() => !readonly && setStatus(s)} style={{
                padding: "6px 14px", borderRadius: C.radius, border: `1px solid ${status === s ? C.primary : C.border}`,
                background: status === s ? C.primary + "15" : C.surface,
                color: status === s ? C.primary : C.muted,
                fontWeight: 600, fontSize: 12, cursor: readonly ? "default" : "pointer", textTransform: "capitalize",
              }}>{s}</button>
            ))}
          </div>
        </Field>

        {status === "deprecated" && (
          <Field label="Deprecation Date" hint="Date after which this app will be sunset">
            <input type="date" style={inputStyle} value={deprecatedAt} onChange={e => setDeprecatedAt(e.target.value)} disabled={readonly} />
          </Field>
        )}
      </div>
    </Card>
  );
}

// ── Section 2: Auth ───────────────────────────────────────────────────────────

function AuthSection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [authRequired, setAuthRequired]   = useState(app.auth_required !== false);
  const [allowedIds, setAllowedIds]       = useState<string[]>(app.allowed_provider_ids ?? []);
  const [providers, setProviders]         = useState<IdentityProvider[]>([]);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState("");

  // Session auth (AppScopedSessions-9)
  const [authMode, setAuthMode]           = useState<App["auth_mode"]>(app.auth_mode ?? "bearer");
  const [sessionMethod, setSessionMethod] = useState<App["session_method"]>(app.session_method ?? "both");
  const [cookieName, setCookieName]       = useState(app.session_config?.cookie_name ?? "");
  const [ttlIdle, setTtlIdle]             = useState(app.session_config?.ttl_idle_min ?? 30);
  const [maxAge, setMaxAge]               = useState(app.session_config?.max_age_min ?? 480);
  const [maxSessions, setMaxSessions]     = useState(app.session_config?.max_sessions_per_user ?? 5);
  const [uaEnforce, setUaEnforce]         = useState<"off" | "flag" | "enforce">(app.session_config?.ua_enforce ?? "flag");
  const [sessionSaved, setSessionSaved]   = useState(false);

  const sessionAuthOn = authMode === "session" || authMode === "both";

  useEffect(() => {
    api.get<ListResult<IdentityProvider>>("/__config/admin/identity-providers")
      .then(d => setProviders(d.results))
      .catch(() => {});
  }, []);

  function toggleProvider(id: string) {
    setAllowedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const updated = await api.put<App>(`/__config/apps/${appId}`, {
        auth_required: authRequired,
        allowed_provider_ids: authRequired ? allowedIds : [],
      });
      onSaved(updated);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  async function saveSessionAuth() {
    setSaving(true); setError(""); setSessionSaved(false);
    try {
      const d = await api.put<{ auth_mode: App["auth_mode"]; session_method: App["session_method"]; session_config: App["session_config"] }>(
        `/__config/apps/${appId}/session-auth`,
        {
          auth_mode: authMode,
          session_method: sessionMethod,
          session_config: {
            cookie_name: cookieName.trim() || undefined,
            ttl_idle_min: ttlIdle,
            max_age_min: maxAge,
            max_sessions_per_user: maxSessions,
            ua_enforce: uaEnforce,
          },
        },
      );
      onSaved({ ...app, auth_mode: d.auth_mode, session_method: d.session_method, session_config: d.session_config });
      setSessionSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const selStyle = (active: boolean) => ({
    flex: 1, padding: "10px 14px", borderRadius: C.radius, cursor: readonly ? "default" : "pointer",
    border: `2px solid ${active ? C.primary : C.border}`,
    background: active ? C.primary + "10" : C.surface,
    textAlign: "left" as const,
  });

  return (
    <Card>
      <SectionHead title="Runtime Authentication" action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn> : undefined} />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}

        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
          Auth Mode
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {[
            { val: "bearer", label: "🔑 Bearer (OIDC)", hint: "End clients send a verified IdP token per request — current behaviour" },
            { val: "session", label: "🍪 Session", hint: "Users log in once via this app's login path; orc_sid cookie afterwards" },
            { val: "both", label: "🔀 Both", hint: "Bearer wins when a token is present, else the session cookie" },
          ].map(opt => (
            <button key={opt.val} onClick={() => !readonly && setAuthMode(opt.val as App["auth_mode"])} style={selStyle(authMode === opt.val)}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{opt.hint}</div>
            </button>
          ))}
        </div>

        {!authRequired && authMode === "bearer" && (
          <div style={{ padding: "10px 14px", background: "#fff8e1", borderRadius: C.radius, border: "1px solid #fcd34d", fontSize: 12, color: "#92400e", marginBottom: 12 }}>
            ⚠ <strong>Auth bypass is ON.</strong> This app accepts requests without any token.
            Use for local development and demos only. Never leave this enabled in production.
          </div>
        )}

        {authMode === "bearer" && authRequired && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
              Allowed Identity Providers
            </div>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
              Leave all unchecked to accept tokens from any active provider.
            </p>
            {providers.length === 0 && (
              <p style={{ fontSize: 12, color: C.muted }}>No identity providers configured. Go to <strong>Admin → Identity Providers</strong> to add one.</p>
            )}
            {providers.map(p => (
              <label key={p._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: C.radius, border: `1px solid ${allowedIds.includes(p._id) ? C.primary : C.border}`, background: allowedIds.includes(p._id) ? C.primary + "08" : C.surface, marginBottom: 6, cursor: readonly ? "default" : "pointer" }}>
                <input type="checkbox" checked={allowedIds.includes(p._id)} onChange={() => !readonly && toggleProvider(p._id)} disabled={readonly} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <code style={{ fontSize: 11, color: C.muted }}>{p.issuer}</code>
                </div>
                <Badge text={p.is_active ? "active" : "inactive"} />
              </label>
            ))}
          </div>
        )}

        {sessionAuthOn && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Session Login
              </div>
              {!readonly && <Btn size="sm" onClick={saveSessionAuth} disabled={saving}>{saving ? "Saving…" : sessionSaved ? "Saved ✓" : "Save Session Settings"}</Btn>}
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              {[
                { val: "gateway", label: "🗄 Gateway auth", hint: `POST {base_path}/login — username/email + password against this app's users` },
                { val: "identity", label: "🌐 Identity Provider", hint: `POST {base_path}/session/verify — verifies an IdP token (SSO)` },
                { val: "both", label: "🔀 Both", hint: "Both login paths are live" },
              ].map(opt => (
                <button key={opt.val} onClick={() => !readonly && setSessionMethod(opt.val as App["session_method"])} style={selStyle(sessionMethod === opt.val)}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{opt.hint}</div>
                </button>
              ))}
            </div>

            {["identity", "both"].includes(sessionMethod) && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
                  Providers accepted at /session/verify
                </div>
                <p style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                  Same list as bearer mode above — manage it in the Bearer section (switch Auth Mode to Bearer, edit, switch back).
                </p>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 12px", marginBottom: 4 }}>
              <Field label="Idle timeout (min)">
                <input type="number" min={5} max={1440} style={inputStyle} value={ttlIdle} onChange={e => setTtlIdle(parseInt(e.target.value) || 30)} disabled={readonly} />
              </Field>
              <Field label="Absolute cap (h)">
                <input type="number" min={1} max={168} style={inputStyle} value={Math.round(maxAge / 60)} onChange={e => setMaxAge((parseInt(e.target.value) || 8) * 60)} disabled={readonly} />
              </Field>
              <Field label="Max sessions/user">
                <input type="number" min={1} max={20} style={inputStyle} value={maxSessions} onChange={e => setMaxSessions(parseInt(e.target.value) || 5)} disabled={readonly} />
              </Field>
              <Field label="Device fingerprint">
                <select style={inputStyle} value={uaEnforce} onChange={e => setUaEnforce(e.target.value as "off" | "flag" | "enforce")} disabled={readonly}>
                  <option value="off">Off</option>
                  <option value="flag">Flag only</option>
                  <option value="enforce">Enforce UA</option>
                </select>
              </Field>
            </div>
            <p style={{ fontSize: 11, color: C.muted, margin: "0 0 12px" }}>
              Sessions die after the idle timeout, no later than the absolute cap. IP changes are never punished — IP is metadata only.
            </p>

            <Field label="Session cookie name" hint="Leave empty for the default (orc_sid_ + base path). Must be unique across apps and cannot be the admin login cookie.">
              <input style={inputStyle} value={cookieName} onChange={e => { setCookieName(e.target.value); setSessionSaved(false); }} placeholder={`orc_sid_${app.base_path.split("/").filter(Boolean).join("_") || "app"}`} disabled={readonly} />
            </Field>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Section 3: Environment Variables ─────────────────────────────────────────

function AiExposeSection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [aiExpose, setAiExpose] = useState(app.ai_expose === true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => { setAiExpose(app.ai_expose === true); }, [app.ai_expose]);

  async function save(next: boolean) {
    setAiExpose(next);
    setSaving(true); setError("");
    try {
      const updated = await api.put<App>(`/__config/apps/${appId}`, { ai_expose: next });
      onSaved(updated);
    } catch (e) {
      setError(String(e));
      setAiExpose(app.ai_expose === true);
    }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionHead title="AI Agent / MCP Exposure" />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: readonly ? "default" : "pointer" }}>
          <input
            type="checkbox"
            checked={aiExpose}
            onChange={e => !readonly && save(e.target.checked)}
            disabled={readonly || saving}
            style={{ marginTop: 2, width: 15, height: 15, accentColor: C.primary }}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Expose this app's endpoints to the AI agent and MCP {saving && <span style={{ color: C.muted }}>— saving…</span>}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              When enabled, every active endpoint becomes a tool that the AI chat agent (and external MCP clients) can discover and call.
              Calls run through the full runtime pipeline and are scoped to the end user bound to each chat.
            </div>
          </div>
        </label>
        {aiExpose && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#fff8e1", border: "1px solid #fcd34d", borderRadius: C.radius, fontSize: 12, color: "#92400e" }}>
            🤖 This app is AI-exposed. Assign it to bots in the <strong>Bot Registry → Bindings tab</strong>.
            If this app uses session auth, AI calls must present a valid orc_sid session — a bare bot key is not accepted
            (a leaked key can never read member data). Normal bearer traffic is unaffected.
          </div>
        )}
      </div>
    </Card>
  );
}

function EnvSection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [vars, setVars]       = useState<AppEnvVar[]>(app.app_env ?? []);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey]   = useState("");
  const [newType, setNewType] = useState<"plain" | "secret">("plain");
  const [newPlain, setNewPlain] = useState("");
  const [newSecretId, setNewSecretId] = useState("");

  useEffect(() => {
    api.get<ListResult<Secret>>("/__config/admin/secrets")
      .then(d => setSecrets(d.results))
      .catch(() => {});
  }, []);

  function addVar() {
    if (!newKey.trim()) return;
    const entry: AppEnvVar = newType === "plain"
      ? { key: newKey.trim(), value_type: "plain", plain_value: newPlain }
      : { key: newKey.trim(), value_type: "secret", secret_id: newSecretId || null };
    setVars(v => [...v.filter(x => x.key !== entry.key), entry]);
    setNewKey(""); setNewPlain(""); setNewSecretId(""); setShowAdd(false);
  }

  function removeVar(key: string) { setVars(v => v.filter(x => x.key !== key)); }

  async function save() {
    setSaving(true); setError("");
    try {
      const updated = await api.put<App>(`/__config/apps/${appId}`, { app_env: vars });
      onSaved(updated);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const secretName = (id: string) => secrets.find(s => s._id === id)?.name ?? id;

  return (
    <Card>
      <SectionHead
        title="Environment Variables"
        action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn> : undefined}
      />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          App-scoped variables available to all endpoints in this app.
          Reference as <code style={{ background: C.bg, padding: "1px 5px", borderRadius: 3 }}>{"{{KEY}}"}</code> in upstream URLs and static header values.
        </p>

        {vars.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "140px 70px 1fr auto", gap: "0 8px", padding: "4px 8px", marginBottom: 4 }}>
              {["KEY","TYPE","VALUE",""].map(h => <span key={h} style={{ fontSize: 10, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{h}</span>)}
            </div>
            {vars.map(v => (
              <div key={v.key} style={{ display: "grid", gridTemplateColumns: "140px 70px 1fr auto", gap: "0 8px", alignItems: "center", padding: "6px 8px", borderRadius: C.radius, border: `1px solid ${C.border}`, marginBottom: 4, background: C.bg }}>
                <code style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>{v.key}</code>
                <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 99, background: v.value_type === "secret" ? "#dc354518" : "#19875418", color: v.value_type === "secret" ? C.danger : C.success, fontWeight: 600 }}>
                  {v.value_type}
                </span>
                <span style={{ fontSize: 12, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {v.value_type === "plain" ? (v.plain_value ?? "") : `•••••••• (${secretName(v.secret_id ?? "")})`}
                </span>
                {!readonly && (
                  <button onClick={() => removeVar(v.key)} style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 16 }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {!readonly && !showAdd && (
          <Btn size="sm" variant="ghost" onClick={() => setShowAdd(true)}>+ Add Variable</Btn>
        )}

        {showAdd && (
          <div style={{ padding: 12, background: "#f8f9fa", borderRadius: C.radius, border: `1px solid ${C.border}`, marginTop: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "0 12px" }}>
              <Field label="Key">
                <input style={inputStyle} value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="BASE_API_URL" autoFocus onKeyDown={e => e.key === "Enter" && addVar()} />
              </Field>
              <Field label="Value Type">
                <select style={inputStyle} value={newType} onChange={e => setNewType(e.target.value as "plain" | "secret")}>
                  <option value="plain">Plain text</option>
                  <option value="secret">Secret ref</option>
                </select>
              </Field>
            </div>
            {newType === "plain" ? (
              <Field label="Value">
                <input style={inputStyle} value={newPlain} onChange={e => setNewPlain(e.target.value)} placeholder="http://host.docker.internal:3001" onKeyDown={e => e.key === "Enter" && addVar()} />
              </Field>
            ) : (
              <Field label="Secret" hint="Select from the global secrets store">
                <select style={inputStyle} value={newSecretId} onChange={e => setNewSecretId(e.target.value)}>
                  <option value="">— select a secret —</option>
                  {secrets.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Btn size="sm" onClick={addVar} disabled={!newKey.trim() || (newType === "secret" && !newSecretId)}>Add</Btn>
              <Btn size="sm" variant="ghost" onClick={() => { setShowAdd(false); setNewKey(""); setNewPlain(""); setNewSecretId(""); }}>Cancel</Btn>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Section 4: Quick Actions ──────────────────────────────────────────────────

const MODE_COLORS: Record<string, { bg: string; color: string }> = {
  dev:     { bg: "#e8f5e9", color: "#2e7d32" },
  qa:      { bg: "#e3f2fd", color: "#1565c0" },
  staging: { bg: "#fff8e1", color: "#f57f17" },
  prod:    { bg: "#fce4ec", color: "#c62828" },
};

function QuickActionsSection({ app, appId, onSaved, onDelete, onClone, readonly }: { app: App; appId: string; onSaved: (a: App) => void; onDelete: () => void; onClone: () => void; readonly: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentMode = (app.mode ?? "prod") as "dev" | "qa" | "staging" | "prod";

  async function setStatus(status: "draft" | "active" | "deprecated") {
    setSaving(true);
    try {
      const updated = await api.put<App>(`/__config/apps/${appId}`, { status });
      onSaved(updated);
    } catch (e) { alert(String(e)); }
    finally { setSaving(false); }
  }

  async function setMode(mode: "dev" | "qa" | "staging" | "prod") {
    setSaving(true);
    try {
      const updated = await api.put<App>(`/__config/apps/${appId}`, { mode });
      onSaved(updated);
    } catch (e) { alert(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <SectionHead title="Quick Actions" />
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Mode selector */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
            Environment Mode
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["dev", "qa", "staging", "prod"] as const).map(m => {
              const active = currentMode === m;
              const colors = MODE_COLORS[m]!;
              return (
                <button key={m} onClick={() => !readonly && !saving && setMode(m)}
                  disabled={readonly || saving}
                  style={{ padding: "5px 14px", borderRadius: C.radius, border: `2px solid ${active ? colors.color : C.border}`, background: active ? colors.bg : C.surface, color: active ? colors.color : C.muted, fontWeight: 600, fontSize: 12, cursor: readonly ? "default" : "pointer", textTransform: "uppercase" }}>
                  {m}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            Mode is an environment label — shown in the UI and sent as <code>X-Orchestrator-Mode</code> response header. It does not affect traffic routing or auth.
          </p>
        </div>

        {/* Status actions */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
            Status
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {app.status !== "active" && !readonly && (
              <Btn variant="success" size="sm" onClick={() => setStatus("active")} disabled={saving}>↑ Publish App</Btn>
            )}
            {app.status === "active" && !readonly && (
              <Btn variant="ghost" size="sm" onClick={() => setStatus("deprecated")} disabled={saving}>↓ Deprecate</Btn>
            )}
            {app.status !== "draft" && !readonly && (
              <Btn variant="ghost" size="sm" onClick={() => setStatus("draft")} disabled={saving}>← Revert to Draft</Btn>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            Current: <Badge text={app.status} />
            {app.status === "draft" && <span style={{ marginLeft: 8 }}>— not serving traffic (invisible to callers)</span>}
            {app.status === "active" && <span style={{ marginLeft: 8 }}>— serving live traffic</span>}
            {app.status === "deprecated" && <span style={{ marginLeft: 8 }}>— serving with Deprecation response header</span>}
          </div>
        </div>

        {/* Danger zone */}
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="outline" size="sm" onClick={onClone}>⎘ Clone App</Btn>
          {!readonly && (
            <Btn variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>✕ Delete App</Btn>
          )}
        </div>
      </div>
      {confirmDelete && (
        <Confirm
          danger
          message={`Permanently delete "${app.name}" and all its endpoints? This cannot be undone.`}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Card>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div style={{ background: "#fff5f5", border: `1px solid #dc354530`, borderRadius: C.radius, padding: "10px 14px", color: "#dc3545", fontSize: 13, marginBottom: 12 }}>{message}</div>;
}

