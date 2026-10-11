import { PageHeaderActions, notifyToast, usePageSave } from "../../../components/PageSave";
import { ArrowLeft, ArrowRight, SlidersHorizontal, ShieldCheck, Braces, Database, History, GitCompareArrows, Plus, Search, RefreshCw, Trash2, Pencil, Lock, KeyRound, Info, TriangleAlert, Copy, Check } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import type { App, AppEnvVar, ListResult, IdentityProvider, Secret, AppDbConnection, DbConnectionType, DbConnOptions } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, Badge, Confirm, C, Toggle, InfoTip, Modal, ErrorBanner, Table, DeleteIcon } from "../../../components";
import { GeneralAppSettings } from "./GeneralAppSettings";
import { HistorySection } from "./HistorySection";
import { useSession } from "../../../auth/SessionContext";

interface Props {
  app: App;
  appId: string;
  onAppUpdated: (updated: App) => void;
  onDeleteApp: () => void;
  onCloneApp: () => void;
  section?: string;
  onRestored?:()=>void;
}

export const APP_SETTINGS_SECTIONS = [
  { key:"general",label:"General",icon:SlidersHorizontal,description:"Name and base path, status, AI and MCP exposure, frontend key, clone and delete." },
  { key:"auth",label:"Runtime Authentication",icon:ShieldCheck,description:"Who can call this app, how sessions behave, and login throttling." },
  { key:"env",label:"Environment Variables",icon:Braces,description:"Values you can reference in any upstream config as {{KEY}}." },
  { key:"db",label:"Database Connections",icon:Database,description:"Named connections for MongoDB, PostgreSQL, and MySQL upstreams." },
  { key:"history",label:"History",icon:History,description:"A snapshot of the app after every change, with roll back." },
  { key:"compare",label:"Compare",icon:GitCompareArrows,description:"See what changed between two snapshots of this app." },
];
export function SettingsTab({ app, appId, onAppUpdated, onDeleteApp, onCloneApp, section, onRestored }: Props) {
  const { can } = useSession(); const navigate=useNavigate();
  const readonly = !can("manage:apps");
  const [counts,setCounts]=useState<{db?:number;history?:number}>({});
  useEffect(()=>{if(section)return;let active=true;Promise.all([api.get<{count?:number;results:unknown[]}>(`/__config/apps/${appId}/db-connections`),api.get<{count?:number;results:unknown[]}>(`/__config/apps/${appId}/history`)]).then(([db,history])=>{if(active)setCounts({db:db.count ?? db.results.length,history:history.count ?? history.results.length});}).catch(()=>{});return()=>{active=false;};},[appId,section]);
  const selected=APP_SETTINGS_SECTIONS.find(s=>s.key===section);
  if (!selected) return <><div className="ui-pagehead" style={{alignItems:"flex-start"}}><div className="ui-row" style={{gap:12,alignItems:"flex-start"}}><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Back" onClick={()=>navigate(`/apps/${appId}`)}><ArrowLeft /></button><div><h1>App settings</h1><p>{app.name} <span className="ui-path">{app.base_path}</span></p></div></div></div><div className="ui-page__body"><div className="ui-cardgrid app-settings-hub">{APP_SETTINGS_SECTIONS.filter(s=>!readonly || !["history","compare"].includes(s.key)).map(s=><button type="button" className="ui-navcard" key={s.key} onClick={()=>navigate(`/apps/${appId}/settings/${s.key}`)}><span className="ui-tile"><s.icon /></span><ArrowRight className="ui-navcard__arrow" size={16} /><span><span className="ui-navcard__title">{s.label}</span><span className="ui-navcard__desc">{s.description}</span></span><span className="ui-navcard__meta">{s.key==="general" ? <><Badge text={app.mode ?? "prod"} /><Badge text={app.status} /></> : s.key==="auth" ? <Badge text={app.auth_required===false ? "Auth off" : "Auth on"} /> : s.key==="env" ? <><span className="ui-count">{(app.app_env ?? []).length}</span>variables</> : s.key==="db" ? <><span className="ui-count">{counts.db ?? "—"}</span>{counts.db===1 ? "connection" : "connections"}</> : s.key==="history" ? <><span className="ui-count">{counts.history ?? "—"}</span>snapshots</> : s.key==="compare" ? "Pick any two snapshots" : null}</span></button>)}</div></div></>;
  if (section === "general") return <GeneralAppSettings key={appId} app={app} appId={appId} onSaved={onAppUpdated} onDelete={onDeleteApp} onClone={onCloneApp} readonly={readonly} frontendKey={<FrontendKeySection app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />} />;
  return <div className="app-settings-detail"><div className="ui-pagehead"><div className="ui-row" style={{alignItems:"flex-start"}}><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Back to app settings" onClick={()=>navigate(`/apps/${appId}/settings`)}><ArrowLeft /></button><div><h1>{selected.label}</h1><p className="ui-muted">{selected.description}</p></div></div></div><div className="ui-page__body"><div className="ui-stack">
    {["history","compare"].includes(section ?? "") && <HistorySection appId={appId} compare={section==="compare"} onRestored={()=>{onRestored?.();navigate(`/apps/${appId}`);}} />}
    {section==="auth" && <AuthSection app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />}
    {section==="env" && <EnvSection app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />}
    {section==="db" && <DbConnectionsSection appId={appId} readonly={readonly} />}
  </div></div></div>;
}

// ── Section 1: General ────────────────────────────────────────────────────────

function GeneralSection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [name, setName]           = useState(app.name);
  const [basePath, setBasePath]   = useState(app.base_path);
  const [description, setDescription] = useState(app.description);
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
      // Status is managed in Quick Actions — only pass it through untouched.
      const body: Record<string, unknown> = {
        name, base_path: basePath, description, status: app.status,
        deprecated_at: app.status === "deprecated" ? (app.deprecated_at ?? null) : null,
      };
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
      <SectionHead title="General" action={!readonly ? <Btn size="sm" pageSave onClick={save} disabled={saving || pathTaken || checking}>{saving ? "Saving…" : "Save"}</Btn> : undefined} />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}
        <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
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
          <div style={{ padding: "8px 12px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 12 }}>
            <strong>Note:</strong> Changing the base path takes effect immediately. Clients calling <code>{app.base_path}</code> will receive 404 until they update to <code>{basePath}</code>.
          </div>
        )}

        <Field label="Description">
          <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56 }} value={description} onChange={e => setDescription(e.target.value)} disabled={readonly} />
        </Field>
      </div>
    </Card>
  );
}

// ── Section 2: Auth ───────────────────────────────────────────────────────────

function AuthSection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [authRequired, setAuthRequired]   = useState(app.auth_required !== false);
  const [authMode, setAuthMode]           = useState<App["auth_mode"]>(app.auth_mode ?? "bearer");
  const [sessionMethod, setSessionMethod] = useState<App["session_method"]>(app.session_method ?? "both");
  const [allowedIds, setAllowedIds]       = useState<string[]>(app.allowed_provider_ids ?? []);
  const [providers, setProviders]         = useState<IdentityProvider[]>([]);
  const [cookieName, setCookieName]       = useState(app.session_config?.cookie_name ?? "");
  const [ttlIdle, setTtlIdle]             = useState(app.session_config?.ttl_idle_min ?? 30);
  const [maxAge, setMaxAge]               = useState(app.session_config?.max_age_min ?? 480);
  const [maxSessions, setMaxSessions]     = useState(app.session_config?.max_sessions_per_user ?? 5);
  const [uaEnforce, setUaEnforce]         = useState<"off" | "flag" | "enforce">(app.session_config?.ua_enforce ?? "flag");
  // ── Identity-provider login (brokered redirect) ──────────────────────────────
  const [postLoginRedirect, setPostLoginRedirect] = useState(app.session_config?.post_login_redirect ?? "");
  const [redirectAllowlist, setRedirectAllowlist] = useState<string[]>(app.session_config?.login_redirect_allowlist ?? []);
  const [newRedirect, setNewRedirect]     = useState("");
  const [linkIdentity, setLinkIdentity]   = useState(app.session_config?.link_identity_on_verified_email ?? true);
  const [requireVerify, setRequireVerify] = useState(app.session_config?.require_email_verification ?? true);
  const [twofaAvailable, setTwofaAvailable] = useState(app.session_config?.twofa_available ?? true);
  const [rateLimitMax, setRateLimitMax]     = useState(app.session_config?.login_rate_limit_max ?? 10);
  const [rateLimitWin, setRateLimitWin]     = useState(app.session_config?.login_rate_limit_window_min ?? 15);
  const [lockoutMax, setLockoutMax]         = useState(app.session_config?.lockout_max_attempts ?? 5);
  const [lockoutDur, setLockoutDur]         = useState(app.session_config?.lockout_duration_min ?? 30);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState("");
  const [saved, setSaved]                 = useState(false);

  const sessionAuthOn = authRequired && (authMode === "session" || authMode === "both");
  const identityInPlay = authRequired && (authMode === "bearer" || (sessionAuthOn && ["identity", "both"].includes(sessionMethod)));

  useEffect(() => {
    api.get<ListResult<IdentityProvider>>("/__config/admin/identity-providers")
      .then(d => setProviders(d.results))
      .catch(() => {});
  }, []);

  function toggleProvider(id: string) {
    setAllowedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setSaved(false);
  }

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      // 1. Master switch + provider allowlist (regular app update)
      let updated = await api.put<App>(`/__config/apps/${appId}`, {
        auth_required: authRequired,
        allowed_provider_ids: identityInPlay ? allowedIds : [],
      });
      // 2. Session auth config (only when session mode is in play)
      {
        const cfg = await api.put<{ auth_mode: App["auth_mode"]; session_method: App["session_method"]; session_config: App["session_config"] }>(
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
              login_redirect_allowlist: redirectAllowlist,
              post_login_redirect: postLoginRedirect.trim() || undefined,
              link_identity_on_verified_email: linkIdentity,
              require_email_verification: requireVerify,
              twofa_available: twofaAvailable,
              login_rate_limit_max: rateLimitMax,
              login_rate_limit_window_min: rateLimitWin,
              lockout_max_attempts: lockoutMax,
              lockout_duration_min: lockoutDur,
            },
          },
        );
        updated = { ...updated, auth_mode: cfg.auth_mode, session_method: cfg.session_method, session_config: cfg.session_config };
      }
      onSaved(updated);
      setSaved(true);
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  usePageSave({authRequired,authMode,sessionMethod,allowedIds,cookieName,ttlIdle,maxAge,maxSessions,uaEnforce,postLoginRedirect,redirectAllowlist,linkIdentity,requireVerify,twofaAvailable,rateLimitMax,rateLimitWin,lockoutMax,lockoutDur},save,{enabled:!readonly,disabled:saving});

  const authMethodTip = authMode === "bearer"
    ? "End clients send a verified identity-provider (OIDC) token on every request. Choose which providers are accepted below."
    : authMode === "session"
    ? "Users log in once through this app's login path and present the orc_sid session cookie on later requests."
    : "Bearer token wins when a valid token is present; otherwise the session cookie is used.";

  const sessionMethodTip = sessionMethod === "gateway"
    ? `POST ${app.base_path}/login with username/email + password against this app's users (managed in the Users tab).`
    : sessionMethod === "identity"
    ? `POST ${app.base_path}/session/verify verifies an identity-provider token (SSO).`
    : "Both login paths are live: gateway password login and identity-provider (SSO) verification.";

  function ProviderChecklist() {
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
          Allowed Identity Providers
          <InfoTip text="Leave all unchecked to accept tokens from any active provider. Providers without a client ID still work for token verification." />
        </div>
        {providers.length === 0 && (
          <p style={{ fontSize: 12, color: C.muted }}>No identity providers configured. Go to <strong>Admin → Identity Providers</strong> to add one.</p>
        )}
        {providers.map(p => (
          <label key={p._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: C.radius, border: `1px solid ${allowedIds.includes(p._id) ? C.primary : C.border}`, background: allowedIds.includes(p._id) ? C.selection : C.surface, marginBottom: 6, cursor: readonly ? "default" : "pointer" }}>
            <input type="checkbox" checked={allowedIds.includes(p._id)} onChange={() => !readonly && toggleProvider(p._id)} disabled={readonly} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
              <code style={{ fontSize: 11, color: C.muted }}>{p.issuer}</code>
            </div>
            <Badge text={p.is_active ? "active" : "inactive"} />
          </label>
        ))}
      </div>
    );
  }

  return <div className="ui-stack">
    {error && <ErrorBanner message={error} />}
    <Card><div className="ui-card__body">
      <div className="ui-row" style={{alignItems:"flex-start",gap:12}}><Toggle checked={authRequired} disabled={readonly} label="Require authentication" onChange={setAuthRequired}/><div><strong>Require authentication</strong><p className="ui-muted" style={{fontSize:12.5,marginTop:2}}>Turn on to reject requests that carry no valid token or session.</p></div></div>
      {!authRequired && <div className="ui-callout ui-callout--warning" style={{marginTop:14}}><TriangleAlert/><span><strong>Auth bypass is on.</strong> Requests without a token or session are accepted.</span></div>}
    </div></Card>
    {authRequired && <Card><SectionHead title="Method"/><div className="ui-card__body"><div className="ui-formgrid">
      <Field label="Authentication method"><select className="ui-select" value={authMode} disabled={readonly || !authRequired} onChange={e=>setAuthMode(e.target.value as App["auth_mode"])}><option value="bearer">Bearer (OIDC token)</option><option value="session">Session cookie</option><option value="both">Both</option></select></Field>
      {sessionAuthOn && <Field label="Session login"><select className="ui-select" value={sessionMethod} disabled={readonly || !authRequired} onChange={e=>setSessionMethod(e.target.value as App["session_method"])}><option value="gateway">Gateway auth (app users)</option><option value="identity">Identity Provider (SSO)</option><option value="both">Both</option></select></Field>}
    </div></div></Card>}
    {sessionAuthOn && <Card><SectionHead title="Sessions"/><div className="ui-card__body"><div className="ui-formgrid">
      <Field label="Idle timeout (min)"><input className="ui-input ui-num" type="number" min={5} max={1440} value={ttlIdle} disabled={readonly || !sessionAuthOn} onChange={e=>setTtlIdle(Number(e.target.value))}/></Field>
      <Field label="Absolute cap (h)"><input className="ui-input ui-num" type="number" min={1} max={168} value={maxAge/60} disabled={readonly || !sessionAuthOn} onChange={e=>setMaxAge(Number(e.target.value)*60)}/></Field>
      <Field label="Max sessions per user"><input className="ui-input ui-num" type="number" min={1} max={20} value={maxSessions} disabled={readonly || !sessionAuthOn} onChange={e=>setMaxSessions(Number(e.target.value))}/></Field>
      <Field label="Device fingerprint"><select className="ui-select" value={uaEnforce} disabled={readonly || !sessionAuthOn} onChange={e=>setUaEnforce(e.target.value as "off"|"flag"|"enforce")}><option value="off">Off</option><option value="flag">Flag only</option><option value="enforce">Enforce UA</option></select></Field>
    </div><Field label="Session cookie name" hint="Leave empty for the default. Must be unique across apps."><input className="ui-input ui-input--mono" value={cookieName} placeholder="orc_sid_…" disabled={readonly || !sessionAuthOn} onChange={e=>setCookieName(e.target.value)}/></Field></div></Card>}
    {sessionAuthOn && ["gateway","both"].includes(sessionMethod) && <Card><SectionHead title="Login throttling"/><div className="ui-card__body"><div className="ui-formgrid">
      <Field label="Max failed attempts"><input className="ui-input ui-num" type="number" min={3} max={100} value={rateLimitMax} disabled={readonly || !sessionAuthOn} onChange={e=>setRateLimitMax(Number(e.target.value))}/></Field>
      <Field label="Window (minutes)"><input className="ui-input ui-num" type="number" min={1} max={60} value={rateLimitWin} disabled={readonly || !sessionAuthOn} onChange={e=>setRateLimitWin(Number(e.target.value))}/></Field>
      <Field label="Max consecutive failures"><input className="ui-input ui-num" type="number" min={0} max={100} value={lockoutMax} disabled={readonly || !sessionAuthOn} onChange={e=>setLockoutMax(Number(e.target.value))}/></Field>
      <Field label="Lockout duration (minutes)"><input className="ui-input ui-num" type="number" min={1} max={1440} value={lockoutDur} disabled={readonly || !sessionAuthOn} onChange={e=>setLockoutDur(Number(e.target.value))}/></Field>
    </div></div></Card>}
    {authRequired && identityInPlay && <Card><SectionHead title="Identity providers"/><div className="ui-card__body"><ProviderChecklist/>{sessionAuthOn && ["identity","both"].includes(sessionMethod) && <IdentityLoginConfig app={app} readonly={readonly} providers={providers} allowedIds={allowedIds} postLoginRedirect={postLoginRedirect} setPostLoginRedirect={setPostLoginRedirect} redirectAllowlist={redirectAllowlist} setRedirectAllowlist={setRedirectAllowlist} newRedirect={newRedirect} setNewRedirect={setNewRedirect} linkIdentity={linkIdentity} setLinkIdentity={setLinkIdentity}/>}</div></Card>}
    {sessionAuthOn && ["gateway","both"].includes(sessionMethod) && <Card><SectionHead title="Two-factor authentication"/><div className="ui-card__body"><div className="ui-row" style={{alignItems:"flex-start",gap:12}}><Toggle checked={twofaAvailable} disabled={readonly} label="Allow users to self-enroll in two-factor authentication" onChange={setTwofaAvailable}/><div><strong>Allow users to self-enroll in two-factor authentication</strong><p className="ui-muted">Users can enroll from their first login. Require it per user in the Users page.</p></div></div></div></Card>}
  </div>;

}

// ── Brokered identity login config (OAuth redirect, IdentityProviderLoginSpecs-3.md)

function IdentityLoginConfig({ app, readonly, providers, allowedIds, postLoginRedirect, setPostLoginRedirect, redirectAllowlist, setRedirectAllowlist, newRedirect, setNewRedirect, linkIdentity, setLinkIdentity }: {
  app: App; readonly: boolean; providers: IdentityProvider[]; allowedIds: string[];
  postLoginRedirect: string; setPostLoginRedirect: (v: string) => void;
  redirectAllowlist: string[]; setRedirectAllowlist: (v: string[]) => void;
  newRedirect: string; setNewRedirect: (v: string) => void;
  linkIdentity: boolean; setLinkIdentity: (v: boolean) => void;
}) {
  const brokered = providers.filter(p => allowedIds.includes(p._id) && p.client_id);
  const callbackUrl = (p: IdentityProvider) => `${window.location.origin}${app.base_path}/auth/callback/${p._id}`;
  const [copied, setCopied] = useState("");

  function addRedirect() {
    const v = newRedirect.trim();
    if (!v || redirectAllowlist.includes(v)) return;
    setRedirectAllowlist([...redirectAllowlist, v]);
    setNewRedirect("");
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard unavailable */ }
  }

  return (
    <div style={{ borderTop: `1px dashed ${C.border}`, margin: "12px 0 4px", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
        Brokered Login (OAuth Redirect)
        <InfoTip text="Providers with a client ID + vault secret get a full redirect login: the browser visits {base_path}/auth/login/{providerId}?redirect=/dashboard and lands back logged in with the session cookie. The frontend never sees provider credentials." />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Callback URLs
          <InfoTip text="Register each URL below at its identity provider as an OAuth redirect/callback URL. Shown only for allowed providers that have a client ID." />
        </div>
        {brokered.length === 0 && (
          <p style={{ fontSize: 12, color: C.muted }}>
            No brokered-login providers yet — set a Client ID + vault secret in <strong>Admin → Identity Providers</strong>.
          </p>
        )}
        {brokered.map(p => (
          <div key={p._id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Badge text={p.name} />
            <code style={{ fontSize: 11, flex: 1, wordBreak: "break-all" }}>{callbackUrl(p)}</code>
            <Btn size="sm" variant="ghost" onClick={() => copy(callbackUrl(p))}>{copied === callbackUrl(p) ? "Copied ✓" : "Copy"}</Btn>
          </div>
        ))}
      </div>

      <Field label={<span>Default landing page<InfoTip text="Where the browser lands after email verification when no ?redirect= was given, e.g. https://app.example.com/login-done." /></span>}>
        <input style={inputStyle} value={postLoginRedirect} onChange={e => setPostLoginRedirect(e.target.value)} placeholder="https://app.example.com/login-done" disabled={readonly} />
      </Field>

      <div style={{ display: "flex", alignItems: "center", fontSize: 12, fontWeight: 600, marginBottom: 6, marginTop: 10 }}>
        Post-login redirect allowlist
        <InfoTip text="The ?redirect= parameter is honoured only for exact origins or origin+path prefixes listed here. Empty = redirects rejected." />
      </div>
      {redirectAllowlist.map(entry => (
        <div key={entry} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <code style={{ fontSize: 11, flex: 1 }}>{entry}</code>
          {!readonly && <DeleteIcon onClick={() => setRedirectAllowlist(redirectAllowlist.filter(x => x !== entry))} label="Remove" />}
        </div>
      ))}
      {!readonly && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={newRedirect} onChange={e => setNewRedirect(e.target.value)} placeholder="https://app.example.com or https://app.example.com/dashboard" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addRedirect(); } }} />
          <Btn size="sm" onClick={addRedirect} disabled={!newRedirect.trim()}>Add</Btn>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12, cursor: readonly ? "default" : "pointer" }}>
        <input type="checkbox" checked={linkIdentity} onChange={e => setLinkIdentity(e.target.checked)} disabled={readonly} />
        Link a verified identity to an existing gateway user with the same email
        <InfoTip text="One user, both login methods. Off = strict sticky method: an email owned by a gateway user can never be claimed by an identity login (409-style conflict on the redirect)." />
      </label>
    </div>
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
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: readonly ? "default" : "pointer" }}>
          <Toggle
            checked={aiExpose}
            onChange={v => !readonly && save(v)}
            disabled={readonly || saving}
            label="Expose to AI agent and MCP"
          />
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            Expose this app's endpoints to the AI agent and MCP {saving && <span style={{ color: C.muted, fontWeight: 400 }}>— saving…</span>}
          </span>
          <InfoTip text="Every active endpoint becomes a tool that the AI chat agent (and external MCP clients) can discover and call. Calls run through the full runtime pipeline and are scoped to the end user bound to each chat." />
        </label>
        {aiExpose && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "var(--warning-background)", border: "1px solid var(--warning)", borderRadius: C.radius, fontSize: 12, color: "var(--warning)" }}>
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
  const [secrets,setSecrets]=useState<Secret[]>([]),[query,setQuery]=useState("");
  const [showAdd,setShowAdd]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [newKey,setNewKey]=useState(""),[newType,setNewType]=useState<"plain"|"secret">("plain"),[newPlain,setNewPlain]=useState(""),[newSecretId,setNewSecretId]=useState("");
  const [removing,setRemoving]=useState<AppEnvVar|null>(null);
  useEffect(()=>{api.get<ListResult<Secret>>("/__config/admin/secrets").then(d=>setSecrets(d.results)).catch(e=>setError(String(e)));},[]);
  const vars=app.app_env ?? [];
  async function persist(next:AppEnvVar[],message:string){setSaving(true);setError("");try{onSaved(await api.put<App>(`/__config/apps/${appId}`,{app_env:next}));notifyToast(message,"success",app.name);return true;}catch(e){setError(String(e));return false;}finally{setSaving(false);}}
  async function refresh(){try{onSaved(await api.get<App>(`/__config/apps/${appId}`));}catch(e){setError(String(e));}}
  async function add(){if(!newKey.trim() || (newType==="secret" && !newSecretId))return;const entry:AppEnvVar=newType==="plain" ? {key:newKey.trim(),value_type:"plain",plain_value:newPlain} : {key:newKey.trim(),value_type:"secret",secret_id:newSecretId};if(await persist([...vars,entry],"Variable added")){setShowAdd(false);setNewKey("");setNewPlain("");setNewSecretId("");}}
  const duplicate=vars.some(v=>v.key===newKey.trim());
  return <>
    {!readonly && <PageHeaderActions><Btn onClick={()=>{setError("");setShowAdd(true);}}><Plus/>Add variable</Btn></PageHeaderActions>}
    {error && !showAdd && <ErrorBanner message={error}/>}
    <Card><div className="ui-card__head"><h2 className="ui-card__title ui-row"><span className="ui-count">{vars.length}</span>{vars.length===1 ? "variable" : "variables"}</h2><div className="ui-row"><div className="ui-search" style={{width:240}}><Search/><input className="ui-input ui-input--sm" aria-label="Filter variables" placeholder="Filter variables" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh variables" onClick={refresh}><RefreshCw/></button></div></div>
    <Table cols={[{key:"key",label:"Key",render:v=><strong className="ui-mono">{String(v)}</strong>},{key:"value_type",label:"Type",render:v=><span className={`ui-badge ${v==="secret" ? "ui-badge--accent" : ""}`}>{v==="secret" ? "Secret ref" : "Plain text"}</span>},{key:"plain_value",label:"Value",render:(v,r)=>r.value_type==="secret" ? <span className="ui-row ui-mono ui-muted"><Lock size={14}/>{secrets.find(s=>s._id===r.secret_id)?.name ?? "Secret reference"}</span> : <span className="ui-mono ui-muted">{String(v ?? "")}</span>},{key:"_actions",label:"",render:(_,r)=>!readonly && <button className="ui-iconbtn" aria-label={`Delete variable ${r.key}`} disabled={saving} onClick={()=>setRemoving(r as unknown as AppEnvVar)}><Trash2/></button>}]} rows={vars.filter(v=>`${v.key} ${v.value_type}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string,unknown>[]}/></Card>
    {showAdd && <Modal title="Add variable" onClose={()=>!saving && setShowAdd(false)}><form onSubmit={e=>{e.preventDefault();add();}}>{error && <ErrorBanner message={error}/>}<div className="ui-formgrid"><Field label="Key"><input className="ui-input ui-input--mono" placeholder="BASE_API_URL" value={newKey} onChange={e=>setNewKey(e.target.value)} required/></Field><Field label="Value type"><select className="ui-select" value={newType} onChange={e=>setNewType(e.target.value as "plain"|"secret")}><option value="plain">Plain text</option><option value="secret">Secret ref</option></select></Field></div>{duplicate && <ErrorBanner message="A variable with this key already exists."/>}{newType==="plain" ? <Field label="Value"><input className="ui-input ui-input--mono" placeholder="http://host.docker.internal:3001" value={newPlain} onChange={e=>setNewPlain(e.target.value)}/></Field> : <Field label="Secret"><select className="ui-select" required value={newSecretId} onChange={e=>setNewSecretId(e.target.value)}><option value="">Select a secret…</option>{secrets.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></Field>}<div className="ui-modal__foot"><Btn variant="secondary" disabled={saving} onClick={()=>setShowAdd(false)}>Cancel</Btn><Btn type="submit" disabled={saving || duplicate || !newKey.trim() || (newType==="secret" && !newSecretId)}>{saving ? "Adding…" : "Add variable"}</Btn></div></form></Modal>}
    {removing && <Confirm danger message={`Remove variable "${removing.key}"? Upstreams that reference it will need updating.`} onCancel={()=>setRemoving(null)} onConfirm={async()=>{if(await persist(vars.filter(v=>v.key!==removing.key),"Variable removed"))setRemoving(null);}}/>}
  </>;
}

function FrontendKeySection({ app, appId, onSaved, readonly }: { app: App; appId: string; onSaved: (a: App) => void; readonly: boolean }) {
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!confirm("Generate a new frontend key? The current key (if any) will be replaced immediately.")) return;
    setBusy(true); setError(""); setNewKey(null);
    try {
      const r = await api.post<{ key: string }>(`/__config/apps/${appId}/frontend-key`, {});
      setNewKey(r.key);
      onSaved({ ...app, frontend_key_set: true });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  async function revoke() {
    if (!confirm("Revoke the frontend key? Login requests will be accepted without a key until you generate a new one.")) return;
    setBusy(true); setError("");
    try {
      await api.del(`/__config/apps/${appId}/frontend-key`);
      setNewKey(null);
      onSaved({ ...app, frontend_key_set: false });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  async function copy() {
    if (!newKey) return;
    try { await navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }

  return <Card><SectionHead title="Frontend key"/><div className="ui-card__body">
    {error && <ErrorBanner message={error}/>}
    <div className="ui-row"><div className="ui-grow"><strong>{app.frontend_key_set ? "Frontend key is active" : "No frontend key"}</strong><p className="ui-muted" style={{fontSize:12.5}}>{app.frontend_key_set ? "Relay servers must provide the X-Frontend-Key header." : "All relays are accepted until you generate one."}</p></div>{!readonly && <div className="ui-row"><Btn variant="secondary" size="sm" onClick={generate} disabled={busy}><KeyRound/>{busy ? "Generating…" : app.frontend_key_set ? "Rotate key" : "Generate key"}</Btn>{app.frontend_key_set && <Btn variant="danger" size="sm" onClick={revoke} disabled={busy}>Revoke</Btn>}</div>}</div>
    <div className="ui-callout ui-callout--neutral" style={{marginTop:14}}><Info/><span>A pre-shared secret that authorises relay servers to submit login requests. When set, every <code>/login</code>, <code>/signup</code>, <code>/auth/login/*</code> and 2FA request must carry the <code>X-Frontend-Key</code> header. The key is shown once, when generated.</span></div>
    {newKey && <div className="ui-callout ui-callout--success" style={{marginTop:14}}><KeyRound/><div className="ui-grow"><strong>Copy this key now — it will not be shown again</strong><div className="ui-row" style={{marginTop:8}}><code style={{wordBreak:"break-all"}}>{newKey}</code><Btn variant="secondary" size="sm" onClick={copy}>{copied ? <Check/> : <Copy/>}{copied ? "Copied" : "Copy"}</Btn></div></div></div>}
  </div></Card>;

}

// ── DB Connections Section ────────────────────────────────────────────────────

const DB_TYPE_LABELS: Record<DbConnectionType, string> = {
  mongodb:    "MongoDB",
  postgresql: "PostgreSQL",
  mysql:      "MySQL",
};

const DB_TYPE_ICONS: Record<DbConnectionType, string> = {
  mongodb:    "🍃",
  postgresql: "🐘",
  mysql:      "🐬",
};

const EMPTY_CONN: Omit<AppDbConnection, "id" | "app_id" | "created_by" | "created_at" | "updated_at"> = {
  name: "", db_type: "postgresql", host: "", database: "", username: null, secret_id: null,
  options: { ssl: false, force_ipv4: false },
};

function DbConnectionsSection({ appId, readonly }: { appId: string; readonly: boolean }) {
  const [connections, setConnections] = useState<AppDbConnection[]>([]);
  const [secrets, setSecrets]         = useState<Secret[]>([]);
  const [loading, setLoading]         = useState(true);
  const [editing, setEditing]         = useState<string | null>(null); // id or "new"
  const [form, setForm]               = useState({ ...EMPTY_CONN });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");
  const [deleteId, setDeleteId]       = useState<string | null>(null);
  const [query,setQuery]=useState("");
  const [showPw, setShowPw]           = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ results: AppDbConnection[] }>(`/__config/apps/${appId}/db-connections`),
      api.get<ListResult<Secret>>("/__config/admin/secrets"),
    ]).then(([conns, secs]) => {
      setConnections(conns.results);
      setSecrets(secs.results);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [appId]);

  function openNew() {
    setForm({ ...EMPTY_CONN });
    setEditing("new");
    setError("");
    setShowPw(false);
  }

  function openEdit(c: AppDbConnection) {
    setForm({ name: c.name, db_type: c.db_type, host: c.host, database: c.database, username: c.username, secret_id: c.secret_id, options: { ssl: Boolean(c.options?.ssl), force_ipv4: Boolean(c.options?.force_ipv4) } });
    setEditing(c.id);
    setError("");
    setShowPw(false);
  }

  function cancelEdit() { setEditing(null); setError(""); }

  async function saveConn() {
    if (!form.name.trim() || !form.host.trim() || !form.database.trim()) {
      setError("Name, host, and database are required."); return;
    }
    setSaving(true); setError("");
    try {
      if (editing === "new") {
        const c = await api.post<AppDbConnection>(`/__config/apps/${appId}/db-connections`, form);
        setConnections(cs => [...cs, c]);
      } else {
        const c = await api.put<AppDbConnection>(`/__config/apps/${appId}/db-connections/${editing}`, form);
        setConnections(cs => cs.map(x => x.id === editing ? c : x));
      }
      notifyToast(editing==="new" ? "Connection added" : "Connection updated");
      setEditing(null);
    } catch (e: any) { setError(String(e)); }
    finally { setSaving(false); }
  }

  async function deleteConn(id: string) {
    try {
      await api.del(`/__config/apps/${appId}/db-connections/${id}`);
      setConnections(cs => cs.filter(c => c.id !== id));notifyToast("Connection removed");
    } catch (e: any) { setError(String(e)); }
    finally { setDeleteId(null); }
  }

  const secretName = (id: string | null) => id ? (secrets.find(s => s._id === id)?.name ?? id) : "—";

  async function refresh(){setLoading(true);try{setConnections((await api.get<{results:AppDbConnection[]}>(`/__config/apps/${appId}/db-connections`)).results);}catch(e){setError(String(e));}finally{setLoading(false);}}
  return <>
    {!readonly && <PageHeaderActions><Btn onClick={openNew}><Plus/>Add connection</Btn></PageHeaderActions>}
    {error && !editing && <ErrorBanner message={error}/>}
    <Card><div className="ui-card__head"><h2 className="ui-card__title ui-row"><span className="ui-count">{connections.length}</span>{connections.length===1 ? "connection" : "connections"}</h2><div className="ui-row"><div className="ui-search" style={{width:240}}><Search/><input className="ui-input ui-input--sm" aria-label="Filter connections" placeholder="Filter connections" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh connections" onClick={refresh}><RefreshCw/></button></div></div>
    {loading ? <div className="ui-card__body">Loading…</div> : <Table cols={[{key:"name",label:"Name",render:v=><strong className="ui-mono">{String(v)}</strong>},{key:"db_type",label:"Type",render:v=><span className="ui-badge">{DB_TYPE_LABELS[v as DbConnectionType]}</span>},{key:"host",label:"Host",render:v=><span className="ui-mono ui-muted">{String(v)}</span>},{key:"database",label:"Database",render:v=><span className="ui-mono">{String(v)}</span>},{key:"options",label:"Options",render:v=><span className="ui-row">{(v as DbConnOptions)?.ssl && <span className="ui-badge ui-badge--accent">SSL</span>}{(v as DbConnOptions)?.force_ipv4 && <span className="ui-badge">Force IPv4</span>}</span>},{key:"_actions",label:"",render:(_,r)=>!readonly && <span className="ui-row"><Btn variant="ghost" size="sm" onClick={()=>openEdit(r as unknown as AppDbConnection)}><Pencil/>Edit</Btn><button className="ui-iconbtn" aria-label={`Delete connection ${r.name}`} onClick={()=>setDeleteId(String(r.id))}><Trash2/></button></span>}]} rows={connections.filter(c=>`${c.name} ${c.host} ${c.database} ${c.db_type}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string,unknown>[]}/>}
    </Card>
    {editing && <Modal title={editing==="new" ? "Add connection" : "Edit connection"} width={620} onClose={()=>!saving && cancelEdit()}><ConnForm form={form} setForm={setForm} secrets={secrets} showPw={showPw} setShowPw={setShowPw} saving={saving} error={error} onSave={saveConn} onCancel={cancelEdit}/></Modal>}
    {deleteId && <Confirm danger message={`Delete connection "${connections.find(c=>c.id===deleteId)?.name}"? Endpoints using it will stop working.`} onConfirm={()=>deleteConn(deleteId)} onCancel={()=>setDeleteId(null)}/>}
  </>;
}

function ConnForm({ form, setForm, secrets, showPw, setShowPw, saving, error, onSave, onCancel }: {
  form: typeof EMPTY_CONN;
  setForm: (f: typeof EMPTY_CONN) => void;
  secrets: Secret[];
  showPw: boolean;
  setShowPw: (v: boolean) => void;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set    = (k: keyof typeof EMPTY_CONN, v: string | null) => setForm({ ...form, [k]: v });
  const setOpt = (k: keyof DbConnOptions, v: boolean) => setForm({ ...form, options: { ...(form.options ?? {}), [k]: v } });

  const hostPlaceholder =
    form.db_type === "mongodb"    ? "localhost:27017" :
    form.db_type === "postgresql" ? "localhost:5432"  :
                                    "localhost:3306";

  return (
    <div>
      {error && <ErrorBanner message={error}/>}
      <div className="ui-formgrid">
        <Field label="Connection Name">
          <input style={inputStyle} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. claims-db-prod" autoFocus />
        </Field>
        <Field label="Type">
          <select style={inputStyle} value={form.db_type} onChange={e => set("db_type", e.target.value as DbConnectionType)}>
            <option value="mongodb">MongoDB</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>
        </Field>
      </div>
      <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
        <Field label="Host" hint="host:port">
          <input style={inputStyle} value={form.host ?? ""} onChange={e => set("host", e.target.value)} placeholder={hostPlaceholder} />
        </Field>
        <Field label="Database">
          <input style={inputStyle} value={form.database ?? ""} onChange={e => set("database", e.target.value)} placeholder="my_database" />
        </Field>
      </div>
      <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
        <Field label="Username (optional)">
          <input style={inputStyle} value={form.username ?? ""} onChange={e => set("username", e.target.value || null)} placeholder="db_user" autoComplete="off" />
        </Field>
        <Field label="Password Secret" hint="Select from the Secrets vault — password is never stored here">
          <select style={inputStyle} value={form.secret_id ?? ""} onChange={e => set("secret_id", e.target.value || null)}>
            <option value="">— no password / use URL auth —</option>
            {secrets.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      {/* ── Connection options ── */}
      <div style={{ marginTop: 10, padding: "10px 14px", background: C.surfaceMuted, color:C.text, borderRadius: C.radius, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>Connection Options</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={Boolean(form.options?.ssl)} onChange={e => setOpt("ssl", e.target.checked)}
              style={{ marginTop: 2, width: 15, height: 15, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Enable TLS / SSL</div>
              <div style={{ fontSize: 11, color: C.muted }}>Required for Supabase, AWS RDS, MongoDB Atlas, PlanetScale, and most managed cloud databases.</div>
            </div>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={Boolean(form.options?.force_ipv4)} onChange={e => setOpt("force_ipv4", e.target.checked)}
              style={{ marginTop: 2, width: 15, height: 15, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Force IPv4</div>
              <div style={{ fontSize: 11, color: C.muted }}>
                Prevents <code>ENETUNREACH</code> when Docker has no IPv6 internet route and the host resolves to an AAAA record first.
                Enable this if you see errors like <code>connect ENETUNREACH 2406:…:5432</code>.
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="ui-modal__foot">
        <Btn size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Btn>
        <Btn size="sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save Connection"}</Btn>
      </div>
    </div>
  );
}

function QuickActionsSection({ app, appId, onSaved, onDelete, onClone, readonly }: { app: App; appId: string; onSaved: (a: App) => void; onDelete: () => void; onClone: () => void; readonly: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deprecatedAt, setDeprecatedAt] = useState(app.deprecated_at ?? "");
  const currentMode = (app.mode ?? "prod") as "dev" | "qa" | "staging" | "prod";

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const updated = await api.put<App>(`/__config/apps/${appId}`, body);
      onSaved(updated);
    } catch (e) { /* The API client reports the failure through the shared toast. */ }
    finally { setSaving(false); }
  }

  function setMode(mode: "dev" | "qa" | "staging" | "prod") { patch({ mode }); }

  function setStatus(status: "draft" | "active" | "deprecated") {
    const body: Record<string, unknown> = { status };
    if (status === "deprecated" && deprecatedAt) body["deprecated_at"] = deprecatedAt;
    if (status !== "deprecated") body["deprecated_at"] = null;
    patch(body);
  }

  const statusHint = app.status === "draft" ? "Not serving traffic (invisible to callers)"
    : app.status === "active" ? "Serving live traffic"
    : "Serving with Deprecation response header";

  return (
    <Card>
      <SectionHead title="Quick Actions" />
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>

        <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Field label="Environment Mode" hint="Environment label — sent as X-Orchestrator-Mode response header; does not affect routing or auth">
            <select
              style={inputStyle}
              value={currentMode}
              disabled={readonly || saving}
              onChange={e => setMode(e.target.value as "dev" | "qa" | "staging" | "prod")}
            >
              {(["dev", "qa", "staging", "prod"] as const).map(m => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))}
            </select>
          </Field>

          <Field label="Status" hint={statusHint}>
            <select
              style={inputStyle}
              value={app.status}
              disabled={readonly || saving}
              onChange={e => setStatus(e.target.value as "draft" | "active" | "deprecated")}
            >
              {(["draft", "active", "deprecated"] as const).map(s => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </Field>
        </div>

        {app.status === "deprecated" && (
          <Field label="Deprecation Date" hint="Date after which this app will be sunset">
            <input
              type="date"
              style={inputStyle}
              value={deprecatedAt}
              disabled={readonly || saving}
              onChange={e => setDeprecatedAt(e.target.value)}
              onBlur={() => { if (deprecatedAt !== (app.deprecated_at ?? "")) setStatus("deprecated"); }}
            />
          </Field>
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>
            Actions
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" size="sm" onClick={onClone}>⎘ Clone App</Btn>
            {!readonly && (
              <DeleteIcon onClick={() => setConfirmDelete(true)} label="Delete App" />
            )}
          </div>
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
