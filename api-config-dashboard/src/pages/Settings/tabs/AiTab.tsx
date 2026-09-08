import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, Spinner, Confirm, Badge, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface AiProvider {
  _id: string; name: string; base_url: string; model: string;
  is_active: boolean; created_at: string;
}

interface AiBot {
  _id: string; name: string; is_active: boolean;
  last_used_at: string | null; created_at: string;
}

interface ToolCall {
  _id: string; bot_name: string; user_id: string; tool_name: string;
  outcome: string; detail: string | null; latency_ms: number; created_at: string;
}

export function AiTab() {
  const { can } = useSession();
  const editable = can("manage:providers");

  // ── Providers ──────────────────────────────────────────────────────────────
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [pName, setPName] = useState("");
  const [pUrl, setPUrl] = useState("");
  const [pModel, setPModel] = useState("");
  const [pKey, setPKey] = useState("");
  const [pError, setPError] = useState("");
  const [pSaving, setPSaving] = useState(false);
  const [providerDelete, setProviderDelete] = useState<AiProvider | null>(null);

  // ── Bots ───────────────────────────────────────────────────────────────────
  const [bots, setBots] = useState<AiBot[]>([]);
  const [showBotForm, setShowBotForm] = useState(false);
  const [bName, setBName] = useState("");
  const [bError, setBError] = useState("");
  const [bSaving, setBSaving] = useState(false);
  const [botDelete, setBotDelete] = useState<AiBot | null>(null);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);

  // ── Tool call audit ────────────────────────────────────────────────────────
  const [calls, setCalls] = useState<ToolCall[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [p, b, c] = await Promise.all([
        api.get<{ results: AiProvider[] }>("/__config/admin/ai/providers"),
        api.get<{ results: AiBot[] }>("/__config/admin/ai/bots"),
        api.get<{ results: ToolCall[] }>("/__config/admin/ai/tool-calls?limit=25"),
      ]);
      setProviders(p.results);
      setBots(b.results);
      setCalls(c.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function addProvider(e: React.FormEvent) {
    e.preventDefault();
    setPSaving(true); setPError("");
    try {
      await api.post("/__config/admin/ai/providers", { name: pName, base_url: pUrl, model: pModel, api_key: pKey });
      setPName(""); setPUrl(""); setPModel(""); setPKey(""); setShowProviderForm(false);
      load();
    } catch (err) { setPError(String(err)); }
    finally { setPSaving(false); }
  }

  async function addBot(e: React.FormEvent) {
    e.preventDefault();
    setBSaving(true); setBError("");
    try {
      const d = await api.post<AiBot & { api_key: string }>("/__config/admin/ai/bots", { name: bName });
      setNewKey({ name: d.name, key: d.api_key });
      setBName(""); setShowBotForm(false);
      load();
    } catch (err) { setBError(String(err)); }
    finally { setBSaving(false); }
  }

  async function toggleBot(bot: AiBot) {
    try {
      await api.put(`/__config/admin/ai/bots/${bot._id}`, { is_active: !bot.is_active });
      load();
    } catch (e) { alert(String(e)); }
  }

  const outcomeColor: Record<string, string> = {
    ok: "#166534", tool_error: "#92400e", scope_violation: "#b91c1c", denied: "#b91c1c",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* ── Providers ─────────────────────────────────────────────────────── */}
      <Card>
        <SectionHead
          title={`LLM Providers (${providers.length})`}
          action={editable ? <Btn size="sm" onClick={() => setShowProviderForm(s => !s)}>{showProviderForm ? "Cancel" : "+ Add Provider"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: "#f0f7ff", fontSize: 12, color: "#1e40af" }}>
          OpenAI-compatible endpoint (OpenAI, Azure, OpenRouter, Ollama, vLLM…).
          The <strong>active provider</strong> powers the AI chat agent and MCP tools. API keys are encrypted at rest.
        </div>

        {showProviderForm && (
          <form onSubmit={addProvider} style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: "#f8f9fa" }}>
            {pError && <ErrorBanner message={pError} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field label="Name"><input style={inputStyle} value={pName} onChange={e => setPName(e.target.value)} placeholder="openai-prod" required /></Field>
              <Field label="Model"><input style={inputStyle} value={pModel} onChange={e => setPModel(e.target.value)} placeholder="gpt-4o-mini" required /></Field>
            </div>
            <Field label="Base URL" hint="OpenAI-compatible chat/completions root, e.g. https://api.openai.com/v1">
              <input style={inputStyle} value={pUrl} onChange={e => setPUrl(e.target.value)} placeholder="https://api.openai.com/v1" required />
            </Field>
            <Field label="API Key"><input style={inputStyle} type="password" value={pKey} onChange={e => setPKey(e.target.value)} placeholder="sk-…" required /></Field>
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
                  <div style={{ fontSize: 12, color: C.muted }}>{p.base_url} · <code>{p.model}</code></div>
                </div>
                {editable && <Btn size="sm" variant="danger" onClick={() => setProviderDelete(p)}>Delete</Btn>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Bots ──────────────────────────────────────────────────────────── */}
      <Card>
        <SectionHead
          title={`AI Bots (${bots.length})`}
          action={editable ? <Btn size="sm" onClick={() => setShowBotForm(s => !s)}>{showBotForm ? "Cancel" : "+ Register Bot"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: "#f0f7ff", fontSize: 12, color: "#1e40af" }}>
          Chatbots call <code>POST /__ai/chat</code> and <code>POST /mcp</code> with header <code>X-Bot-Key</code>.
          Each request must bind the end user via <code>user.id</code> — the agent is scoped to that user's data only.
        </div>

        {showBotForm && (
          <form onSubmit={addBot} style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: "#f8f9fa" }}>
            {bError && <ErrorBanner message={bError} />}
            <Field label="Bot Name"><input style={inputStyle} value={bName} onChange={e => setBName(e.target.value)} placeholder="member-portal-bot" required autoFocus /></Field>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <Btn type="submit" disabled={bSaving}>{bSaving ? "Generating…" : "Register Bot"}</Btn>
            </div>
          </form>
        )}

        {newKey && (
          <div style={{ margin: "12px 16px", padding: 14, border: "1px solid #86efac", background: "#f0fdf4", borderRadius: C.radius }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#166534", marginBottom: 6 }}>✓ Bot "{newKey.name}" registered — copy the key now, it will not be shown again</div>
            <code style={{ display: "block", padding: "8px 10px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 12, wordBreak: "break-all" }}>{newKey.key}</code>
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <Btn size="sm" variant="ghost" onClick={() => setNewKey(null)}>Done — I saved it</Btn>
            </div>
          </div>
        )}

        {loading ? <Spinner /> : (
          <div style={{ padding: "8px 16px" }}>
            {bots.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>No bots registered yet.</div>}
            {bots.map(b => (
              <div key={b._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                    {b.name} {b.is_active ? <Badge text="active" /> : <Badge text="disabled" />}
                  </div>
                  <div style={{ fontSize: 12, color: C.muted }}>
                    Last used: {b.last_used_at ? new Date(b.last_used_at).toLocaleString() : "never"}
                  </div>
                </div>
                {editable && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn size="sm" variant="outline" onClick={() => toggleBot(b)}>{b.is_active ? "Disable" : "Enable"}</Btn>
                    <Btn size="sm" variant="danger" onClick={() => setBotDelete(b)}>Delete</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Tool call audit ───────────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Recent AI Tool Calls" action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>} />
        {loading ? <Spinner /> : (
          <div style={{ padding: "8px 16px" }}>
            {calls.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>No tool calls yet.</div>}
            {calls.map(c => (
              <div key={c._id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: outcomeColor[c.outcome] ?? C.text }}>{c.outcome}</span>
                  <code>{c.tool_name}</code>
                  <span style={{ color: C.muted }}>by {c.bot_name || "unknown bot"} · user {c.user_id || "—"} · {c.latency_ms}ms</span>
                </div>
                {c.detail && <div style={{ color: C.muted, marginTop: 2 }}>{c.detail}</div>}
                <div style={{ color: C.muted, marginTop: 1 }}>{new Date(c.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {providerDelete && (
        <Confirm
          message={`Delete provider "${providerDelete.name}"? The AI agent and MCP endpoint will stop working until another provider is configured.`}
          danger
          onCancel={() => setProviderDelete(null)}
          onConfirm={async () => {
            try { await api.del(`/__config/admin/ai/providers/${providerDelete._id}`); setProviderDelete(null); load(); }
            catch (e) { alert(String(e)); }
          }}
        />
      )}

      {botDelete && (
        <Confirm
          message={`Delete bot "${botDelete.name}"? Its API key stops working immediately — any chatbot using it will get 401.`}
          danger
          onCancel={() => setBotDelete(null)}
          onConfirm={async () => {
            try { await api.del(`/__config/admin/ai/bots/${botDelete._id}`); setBotDelete(null); load(); }
            catch (e) { alert(String(e)); }
          }}
        />
      )}
    </div>
  );
}
