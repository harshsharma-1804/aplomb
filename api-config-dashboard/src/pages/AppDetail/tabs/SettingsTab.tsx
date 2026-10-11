import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import type { App, AppEnvVar, ListResult, IdentityProvider, Secret, AppDbConnection, DbConnectionType } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, Badge, Confirm, C, Toggle, InfoTip } from "../../../components";
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
      <FrontendKeySection app={app} appId={appId} onSaved={onAppUpdated} readonly={readonly} />
      <DbConnectionsSection appId={appId} readonly={readonly} />
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
      if (sessionAuthOn) {
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
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

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

  return (
    <Card>
      <SectionHead title="Runtime Authentication" action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined} />
      <div style={{ padding: 16 }}>
        {error && <ErrorBanner message={error} />}

        {/* ── Master toggle ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Toggle checked={authRequired} onChange={v => { setAuthRequired(v); setSaved(false); }} disabled={readonly} label="Require authentication" />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Require authentication</span>
          <InfoTip text="Every caller must authenticate using the method below. Turning this off makes the app accept unauthenticated traffic — dev/demo only, never for production." />
        </div>

        {!authRequired && (
          <div style={{ padding: "10px 14px", background: "var(--warning-background)", borderRadius: C.radius, border: "1px solid var(--warning)", fontSize: 12, color: "var(--warning)", marginBottom: 16 }}>
            ⚠ <strong>Auth bypass is ON.</strong> Requests without a token or session are accepted.
          </div>
        )}

        {/* ── Required Auth → method selectors ───────────────────────────── */}
        {authRequired && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: sessionAuthOn ? "1fr 1fr" : "1fr", gap: "0 16px", marginBottom: 4 }}>
              <Field label={<span>Authentication Method<InfoTip text={authMethodTip} /></span>}>
                <select
                  style={inputStyle}
                  value={authMode}
                  disabled={readonly}
                  onChange={e => { setAuthMode(e.target.value as App["auth_mode"]); setSaved(false); }}
                >
                  <option value="bearer">Bearer (OIDC token)</option>
                  <option value="session">Session cookie</option>
                  <option value="both">Both</option>
                </select>
              </Field>

              {sessionAuthOn && (
                <Field label={<span>Session Login<InfoTip text={sessionMethodTip} /></span>}>
                  <select
                    style={inputStyle}
                    value={sessionMethod}
                    disabled={readonly}
                    onChange={e => { setSessionMethod(e.target.value as App["session_method"]); setSaved(false); }}
                  >
                    <option value="gateway">Gateway auth (app users)</option>
                    <option value="identity">Identity Provider (SSO)</option>
                    <option value="both">Both</option>
                  </select>
                </Field>
              )}
            </div>

            {/* Bearer → providers */}
            {authMode === "bearer" && <ProviderChecklist />}

            {/* Session / Both → session login config */}
            {sessionAuthOn && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 4 }}>
                {["gateway", "both"].includes(sessionMethod) && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 14, cursor: readonly ? "default" : "pointer" }}>
                    <input type="checkbox" checked={twofaAvailable} onChange={e => { setTwofaAvailable(e.target.checked); setSaved(false); }} disabled={readonly} />
                    Allow users to self-enroll in two-factor authentication
                    <InfoTip text="Users can enroll in two-factor auth (authenticator app or email codes) from their first login; you can require it per user in the Users tab." />
                  </label>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 12px", marginBottom: 4 }}>
                  <Field label={<span>Idle timeout (min)<InfoTip text="Sessions die after this many minutes of inactivity — no later than the absolute cap. IP changes are never punished; IP is metadata only." /></span>}>
                    <input type="number" min={5} max={1440} style={inputStyle} value={ttlIdle} onChange={e => { setTtlIdle(parseInt(e.target.value) || 30); setSaved(false); }} disabled={readonly} />
                  </Field>
                  <Field label="Absolute cap (h)">
                    <input type="number" min={1} max={168} style={inputStyle} value={Math.round(maxAge / 60)} onChange={e => { setMaxAge((parseInt(e.target.value) || 8) * 60); setSaved(false); }} disabled={readonly} />
                  </Field>
                  <Field label="Max sessions/user">
                    <input type="number" min={1} max={20} style={inputStyle} value={maxSessions} onChange={e => { setMaxSessions(parseInt(e.target.value) || 5); setSaved(false); }} disabled={readonly} />
                  </Field>
                  <Field label="Device fingerprint">
                    <select style={inputStyle} value={uaEnforce} onChange={e => { setUaEnforce(e.target.value as "off" | "flag" | "enforce"); setSaved(false); }} disabled={readonly}>
                      <option value="off">Off</option>
                      <option value="flag">Flag only</option>
                      <option value="enforce">Enforce UA</option>
                    </select>
                  </Field>
                </div>

                 <Field label={<span>Session cookie name<InfoTip text="Leave empty for the default (orc_sid_ + base path). Must be unique across apps and cannot be the admin login cookie." /></span>}>
                   <input style={inputStyle} value={cookieName} onChange={e => { setCookieName(e.target.value); setSaved(false); }} placeholder={`orc_sid_${app.base_path.split("/").filter(Boolean).join("_") || "app"}`} disabled={readonly} />
                 </Field>

                 <div style={{ borderTop: `1px dashed ${C.border}`, margin: "12px 0 8px" }} />
                 <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>Login rate limiting (per IP)</div>
                 <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
                   After this many failed attempts from one IP, further logins are blocked for the window duration and return <code>429</code>.
                 </p>
                 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                   <Field label="Max failed attempts" hint="Min 3 · Max 100">
                     <input type="number" min={3} max={100} style={inputStyle} value={rateLimitMax} onChange={e => { setRateLimitMax(parseInt(e.target.value) || 10); setSaved(false); }} disabled={readonly} />
                   </Field>
                   <Field label="Window (minutes)" hint="Min 1 · Max 60">
                     <input type="number" min={1} max={60} style={inputStyle} value={rateLimitWin} onChange={e => { setRateLimitWin(parseInt(e.target.value) || 15); setSaved(false); }} disabled={readonly} />
                   </Field>
                 </div>

                 <div style={{ borderTop: `1px dashed ${C.border}`, margin: "12px 0 8px" }} />
                 <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".4px" }}>Username lockout</div>
                 <p style={{ fontSize: 12, color: C.muted, margin: "0 0 10px" }}>
                   Blocks an account after too many consecutive failures, regardless of IP. Set to <strong>0</strong> to disable. Admins can unlock from the Users tab.
                 </p>
                 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                   <Field label="Max consecutive failures" hint="0 = disabled · account is locked after this many wrong passwords">
                     <input type="number" min={0} max={100} style={inputStyle} value={lockoutMax} onChange={e => { setLockoutMax(parseInt(e.target.value) ?? 5); setSaved(false); }} disabled={readonly} />
                   </Field>
                   <Field label="Lockout duration (minutes)" hint="Max 1440 (24 h)">
                     <input type="number" min={1} max={1440} style={inputStyle} value={lockoutDur} onChange={e => { setLockoutDur(parseInt(e.target.value) || 30); setSaved(false); }} disabled={readonly} />
                   </Field>
                 </div>

                {["identity", "both"].includes(sessionMethod) && (
                  <>
                    <ProviderChecklist />
                    <IdentityLoginConfig
                      app={app} readonly={readonly}
                      providers={providers} allowedIds={allowedIds}
                      postLoginRedirect={postLoginRedirect} setPostLoginRedirect={(v) => { setPostLoginRedirect(v); setSaved(false); }}
                      redirectAllowlist={redirectAllowlist} setRedirectAllowlist={(v) => { setRedirectAllowlist(v); setSaved(false); }}
                      newRedirect={newRedirect} setNewRedirect={setNewRedirect}
                      linkIdentity={linkIdentity} setLinkIdentity={(v) => { setLinkIdentity(v); setSaved(false); }}
                    />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
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
          {!readonly && <Btn size="sm" variant="danger" onClick={() => setRedirectAllowlist(redirectAllowlist.filter(x => x !== entry))}>Remove</Btn>}
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
                <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 99, background: v.value_type === "secret" ? "var(--danger)18" : "var(--success)18", color: v.value_type === "secret" ? C.danger : C.success, fontWeight: 600 }}>
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
          <div style={{ padding: 12, background: "var(--surface-muted)", borderRadius: C.radius, border: `1px solid ${C.border}`, marginTop: 8 }}>
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

  return (
    <Card>
      <SectionHead title="Frontend Key" />
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 12px" }}>
          A pre-shared secret that authorises relay servers (e.g. your Next.js backend) to submit login requests
          on behalf of users. When set, every <code>/login</code>, <code>/signup</code>, <code>/auth/login/*</code>
          and 2FA request must carry <code>X-Frontend-Key: &lt;key&gt;</code>.
          Prevents any unauthorised relay from authenticating users on this app —
          including those bypassing CORS via server-to-server calls.
        </p>
        {error && <ErrorBanner message={error} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: C.radius, border: `1px solid ${C.border}`, background: C.bg, marginBottom: 12 }}>
          <span style={{ fontSize: 13, flex: 1 }}>
            {app.frontend_key_set ? "🔐 Frontend key is active" : "⚪ No frontend key — all relays accepted"}
          </span>
          {!readonly && (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn size="sm" onClick={generate} disabled={busy}>{busy ? "Generating…" : app.frontend_key_set ? "Rotate key" : "Generate key"}</Btn>
              {app.frontend_key_set && <Btn size="sm" variant="danger" onClick={revoke} disabled={busy}>Revoke</Btn>}
            </div>
          )}
        </div>
        {newKey && (
          <div style={{ padding: "12px 14px", borderRadius: C.radius, border: "1px solid #9ae6b4", background: "#f0fff4" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#276749", marginBottom: 6 }}>
              ⚠ Copy this key now — it will not be shown again
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <code style={{ fontSize: 12, flex: 1, wordBreak: "break-all", color: "#276749" }}>{newKey}</code>
              <Btn size="sm" variant="ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</Btn>
            </div>
            <p style={{ fontSize: 11, color: "#276749", margin: "8px 0 0" }}>
              Set this as <code>APP_FRONTEND_KEY=&lt;key&gt;</code> in your relay server's env and send it as <code>X-Frontend-Key</code> on every login request.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
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

const EMPTY_CONN: Omit<AppDbConnection, "id" | "app_id" | "created_by" | "created_at" | "updated_at" | "options"> = {
  name: "", db_type: "postgresql", host: "", database: "", username: null, secret_id: null,
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
    setForm({ name: c.name, db_type: c.db_type, host: c.host, database: c.database, username: c.username, secret_id: c.secret_id });
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
      setEditing(null);
    } catch (e: any) { setError(String(e)); }
    finally { setSaving(false); }
  }

  async function deleteConn(id: string) {
    try {
      await api.del(`/__config/apps/${appId}/db-connections/${id}`);
      setConnections(cs => cs.filter(c => c.id !== id));
    } catch (e: any) { setError(String(e)); }
    finally { setDeleteId(null); }
  }

  const secretName = (id: string | null) => id ? (secrets.find(s => s._id === id)?.name ?? id) : "—";

  return (
    <Card>
      <SectionHead
        title="Database Connections"
        action={!readonly ? <Btn size="sm" variant="ghost" onClick={openNew}>+ Add Connection</Btn> : undefined}
      />
      <div style={{ padding: 16 }}>
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 12px" }}>
          Named database connections for this app. Endpoints can reference a connection by name instead of entering a raw URL — credentials are resolved from the Secrets vault at runtime.
        </p>

        {loading && <p style={{ fontSize: 12, color: C.muted }}>Loading…</p>}

        {/* Connection list */}
        {!loading && connections.length === 0 && editing !== "new" && (
          <p style={{ fontSize: 12, color: C.muted }}>No connections yet. Add one to use it in endpoint Upstream configuration.</p>
        )}

        {connections.map(c => (
          <div key={c.id} style={{ marginBottom: 8 }}>
            {editing === c.id ? (
              <ConnForm
                form={form} setForm={setForm} secrets={secrets}
                showPw={showPw} setShowPw={setShowPw}
                saving={saving} error={error}
                onSave={saveConn} onCancel={cancelEdit}
              />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: C.radius, border: `1px solid ${C.border}`, background: C.bg }}>
                <span style={{ fontSize: 18 }}>{DB_TYPE_ICONS[c.db_type]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    <span style={{ marginRight: 10 }}><strong>{DB_TYPE_LABELS[c.db_type]}</strong></span>
                    <span style={{ marginRight: 10 }}>{c.host}/{c.database}</span>
                    {c.username && <span style={{ marginRight: 10 }}>user: {c.username}</span>}
                    {c.secret_id && <span>🔒 {secretName(c.secret_id)}</span>}
                  </div>
                </div>
                {!readonly && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn size="sm" variant="ghost" onClick={() => openEdit(c)}>Edit</Btn>
                    <Btn size="sm" variant="danger" onClick={() => setDeleteId(c.id)}>Delete</Btn>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {editing === "new" && (
          <ConnForm
            form={form} setForm={setForm} secrets={secrets}
            showPw={showPw} setShowPw={setShowPw}
            saving={saving} error={error}
            onSave={saveConn} onCancel={cancelEdit}
          />
        )}

        {error && !editing && <p style={{ fontSize: 12, color: C.danger, marginTop: 8 }}>{error}</p>}
      </div>

      {deleteId && (
        <Confirm
          message={`Delete connection "${connections.find(c => c.id === deleteId)?.name}"? Endpoints using it will stop working.`}
          onConfirm={() => deleteConn(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </Card>
  );
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
  const set = (k: keyof typeof EMPTY_CONN, v: string | null) => setForm({ ...form, [k]: v });

  const hostPlaceholder =
    form.db_type === "mongodb"    ? "localhost:27017" :
    form.db_type === "postgresql" ? "localhost:5432"  :
                                    "localhost:3306";

  return (
    <div style={{ padding: 14, borderRadius: C.radius, border: `1px solid ${C.primary}`, background: C.selection, marginBottom: 8 }}>
      {error && <p style={{ fontSize: 12, color: C.danger, margin: "0 0 10px" }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: "0 10px" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
        <Field label="Host" hint="host:port">
          <input style={inputStyle} value={form.host ?? ""} onChange={e => set("host", e.target.value)} placeholder={hostPlaceholder} />
        </Field>
        <Field label="Database">
          <input style={inputStyle} value={form.database ?? ""} onChange={e => set("database", e.target.value)} placeholder="my_database" />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
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
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
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
    } catch (e) { alert(String(e)); }
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
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
            <Btn variant="outline" size="sm" onClick={onClone}>⎘ Clone App</Btn>
            {!readonly && (
              <Btn variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>✕ Delete App</Btn>
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

function ErrorBanner({ message }: { message: string }) {
  return <div style={{ background: "var(--danger-background)", border: `1px solid var(--danger)`, borderRadius: C.radius, padding: "10px 14px", color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{message}</div>;
}

