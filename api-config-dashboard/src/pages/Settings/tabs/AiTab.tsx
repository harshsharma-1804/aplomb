import { Plus, Trash2, Lock } from "lucide-react";
import { PageHeaderActions } from "../../../components/PageSave";
import { CollectionHead } from "../../../components/CollectionHead";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import type { AiProvider, AiToolCall } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, Badge, C, Modal, Table } from "../../../components";
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
  const [query,setQuery]=useState("");
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

      {editable && <PageHeaderActions><Btn onClick={()=>setShowProviderForm(true)}><Plus/>Add provider</Btn></PageHeaderActions>}
      <Card><CollectionHead count={providers.length} noun="providers" query={query} onQuery={setQuery} onRefresh={load}/>{loading ? <Spinner/> : <Table cols={[{key:"name",label:"Provider",render:v=><strong style={{fontWeight:600}}>{String(v)}</strong>},{key:"base_url",label:"Base URL",render:v=><span className="ui-mono ui-muted">{String(v)}</span>},{key:"model",label:"Model",render:v=><span className="ui-mono">{String(v)}</span>},{key:"secret_id",label:"Auth",render:(v,r)=>v ? <span className="ui-row ui-mono ui-muted"><Lock size={14}/>{String(r.secret_name || "Vault reference")}</span> : <span className="ui-badge">Local</span>},{key:"is_active",label:"Status",render:v=><Badge text={v ? "active" : "disabled"}/>},{key:"_actions",label:"",render:(_,r)=>editable && <button className="ui-iconbtn" aria-label={`Delete provider ${r.name}`} onClick={()=>setProviderDelete(r as unknown as AiProvider)}><Trash2/></button>}]} rows={providers.filter(p=>`${p.name} ${p.model} ${p.base_url}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string,unknown>[]}/>}<div className="ui-card__foot">API keys are stored as vault references, never as plain text. Assign providers to bots in Bot Registry, Bindings.</div></Card>
      {showProviderForm && <Modal title="Add provider" onClose={()=>!pSaving && setShowProviderForm(false)}>          <form onSubmit={addProvider}>
            {pError && <ErrorBanner message={pError} />}
            <div className="app-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
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
            <div className="ui-modal__foot"><Btn variant="secondary" disabled={pSaving} onClick={()=>setShowProviderForm(false)}>Cancel</Btn>
              <Btn type="submit" disabled={pSaving}>{pSaving ? "Saving…" : "Add Provider"}</Btn>
            </div>
          </form></Modal>}

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
            catch (e) { /* The API client reports the failure through the shared toast. */ }
          }}
        />
      )}
    </div>
  );
}
