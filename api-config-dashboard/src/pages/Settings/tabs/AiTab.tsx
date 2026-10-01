import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import type { AiProvider, AiToolCall } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, Badge, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface VaultSecret { _id: string; name: string; }

const OUTCOME_COLOR: Record<string, string> = {
  ok: "var(--success)", tool_error: "var(--warning)", scope_violation: "var(--danger)", denied: "var(--danger)",
};

export function AiTab() {
  const { can } = useSession();
  const navigate = useNavigate();
  const editable = can("manage:providers");

  const [providers, setProviders]     = useState<AiProvider[]>([]);
  const [vaultSecrets, setVaultSecrets] = useState<VaultSecret[]>([]);
  const [calls, setCalls]             = useState<AiToolCall[]>([]);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [pName, setPName]             = useState("");
  const [pUrl, setPUrl]               = useState("");
  const [pModel, setPModel]           = useState("");
  const [pSecretId, setPSecretId]     = useState("");
  const [pNoAuth, setPNoAuth]         = useState(false);
  const [pError, setPError]           = useState("");
  const [pSaving, setPSaving]         = useState(false);
  const [providerDelete, setProviderDelete] = useState<AiProvider | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  async function load() {
    setLoading(true);
    try {
      const [p, v, c] = await Promise.all([
        api.get<{ results: AiProvider[] }>("/__config/admin/ai/providers"),
        api.get<{ results: VaultSecret[] }>("/__config/admin/secrets"),
        api.get<{ results: AiToolCall[] }>("/__config/admin/ai/tool-calls?limit=25"),
      ]);
      setProviders(p.results);
      setVaultSecrets(v.results);
      setCalls(c.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function addProvider(e: React.FormEvent) {
    e.preventDefault();
    setPSaving(true); setPError("");
    try {
      await api.post("/__config/admin/ai/providers", { name: pName, base_url: pUrl, model: pModel, ...(pNoAuth ? { no_auth: true } : { secret_id: pSecretId }) });
      setPName(""); setPUrl(""); setPModel(""); setPSecretId(""); setPNoAuth(false); setShowProviderForm(false);
      load();
    } catch (err) { setPError(String(err)); }
    finally { setPSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* Bot Registry shortcut */}
      <Card>
        <SectionHead
          title="Bot Registry"
          action={<Btn size="sm" onClick={() => navigate("/bots")}>Open Bot Registry →</Btn>}
        />
        <div style={{ padding: "12px 16px", fontSize: 13, color: C.muted }}>
          Bots are managed in the <strong>Bot Registry</strong> — register bots, configure rules, guardrails, bindings, limits and view per-bot audit trails there.
        </div>
      </Card>

      {/* LLM Providers */}
      <Card>
        <SectionHead
          title={`LLM Providers (${providers.length})`}
          action={editable ? <Btn size="sm" onClick={() => setShowProviderForm(s => !s)}>{showProviderForm ? "Cancel" : "+ Add Provider"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: "var(--selection)", fontSize: 12, color: "var(--primary)" }}>
          OpenAI-compatible endpoints (OpenAI, Azure, OpenRouter, Ollama, vLLM…). API keys are stored as vault references — never as plain text.
          Assign providers to bots in the Bot Registry → Bindings tab.
        </div>

        {showProviderForm && (
          <form onSubmit={addProvider} style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: "var(--surface-muted)" }}>
            {pError && <ErrorBanner message={pError} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field label="Name"><input style={inputStyle} value={pName} onChange={e => setPName(e.target.value)} placeholder="openai-prod" required /></Field>
              <Field label="Model"><input style={inputStyle} value={pModel} onChange={e => setPModel(e.target.value)} placeholder="gpt-4o-mini" required /></Field>
            </div>
            <Field label="Base URL" hint="OpenAI-compatible root, e.g. https://api.openai.com/v1">
              <input style={inputStyle} value={pUrl} onChange={e => setPUrl(e.target.value)} placeholder="https://api.openai.com/v1" required />
            </Field>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {([["vault", "🔒 Vault secret (requires API key)"], ["local", "🖥 No auth (local / open model)"]] as const).map(([val, label]) => (
                <button key={val} type="button" onClick={() => setPNoAuth(val === "local")} style={{
                  flex: 1, padding: "8px 12px", borderRadius: C.radius, cursor: "pointer",
                  border: `2px solid ${(val === "local") === pNoAuth ? C.primary : C.border}`,
                  background: (val === "local") === pNoAuth ? C.selection : C.surface,
                  fontWeight: 600, fontSize: 12, color: (val === "local") === pNoAuth ? C.primary : C.text,
                }}>{label}</button>
              ))}
            </div>
            {!pNoAuth && (
              <Field label="API Key (from vault)" hint="Keys are never entered as plain text — pick a secret from Admin → Secrets; rotate it there and providers pick it up automatically">
                <select style={{ ...inputStyle, cursor: "pointer" }} value={pSecretId} onChange={e => setPSecretId(e.target.value)} required>
                  <option value="">{vaultSecrets.length === 0 ? "No secrets in vault — create one in Admin → Secrets first" : "Select a secret…"}</option>
                  {vaultSecrets.map(v => <option key={v._id} value={v._id}>{v.name}</option>)}
                </select>
              </Field>
            )}
            {pNoAuth && (
              <div style={{ padding: "8px 12px", background: "var(--success-background)", border: "1px solid var(--success)", borderRadius: C.radius, fontSize: 12, color: "var(--success)" }}>
                ✓ No API key required — the orchestrator will call this endpoint without an Authorization header. Suitable for Ollama, llama.cpp, and other local model servers.
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Btn type="submit" disabled={pSaving}>{pSaving ? "Saving…" : "Add Provider"}</Btn>
            </div>
          </form>
        )}

        {loading ? <Spinner /> : (
          <div style={{ padding: "8px 16px" }}>
            {providers.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>No providers configured yet.</div>}
            {providers.map(p => (
              <div key={p._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                    {p.name} {p.is_active && <Badge text="active" />}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    {p.base_url} · <code>{p.model}</code> · {p.secret_id ? `🔒 vault (${p.secret_name ?? 'secret'})` : <span style={{ background: 'var(--success-background)', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>local · no auth</span>}
                  </div>
                </div>
                {editable && <Btn size="sm" variant="danger" onClick={() => setProviderDelete(p)}>Delete</Btn>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Global tool-call audit (last 25) */}
      <Card>
        <SectionHead title="Recent Tool Calls (all bots)" action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>} />
        {loading ? <Spinner /> : (
          <div style={{ padding: "8px 16px" }}>
            {calls.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>No tool calls yet.</div>}
            {calls.map(c => (
              <div key={c._id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: OUTCOME_COLOR[c.outcome] ?? C.text }}>{c.outcome}</span>
                  <code>{c.tool_name}</code>
                  <span style={{ color: C.muted }}>by {c.bot_name || "unknown"} · user {c.user_id || "—"} · {c.latency_ms}ms</span>
                </div>
                {c.detail && <div style={{ color: C.muted, marginTop: 2 }}>{c.detail}</div>}
                <div style={{ color: C.muted }}>{new Date(c.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {providerDelete && (
        <Confirm
          message={`Delete provider "${providerDelete.name}"? Any bot using it will lose its assigned LLM until reassigned.`}
          danger
          onCancel={() => setProviderDelete(null)}
          onConfirm={async () => {
            try { await api.del(`/__config/admin/ai/providers/${providerDelete._id}`); setProviderDelete(null); load(); }
            catch (e) { alert(String(e)); }
          }}
        />
      )}
    </div>
  );
}
