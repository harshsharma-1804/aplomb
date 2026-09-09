import { useState } from "react";
import { api } from "../../../api/client";
import type { AiBot, BotLimits } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function LimitsTab({ bot, onUpdated, readonly }: Props) {
  const [limits, setLimits] = useState<BotLimits>(bot.limits ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [saved, setSaved]   = useState(false);
  const [newTopic, setNewTopic] = useState("");

  function setL<K extends keyof BotLimits>(key: K, val: BotLimits[K]) {
    setLimits(prev => ({ ...prev, [key]: val }));
    setSaved(false);
  }

  function setNum(key: keyof BotLimits, raw: string) {
    const val = raw === "" ? undefined : parseInt(raw, 10);
    setL(key, isNaN(val as number) ? undefined : val as any);
  }

  function addTopic() {
    const t = newTopic.trim();
    if (!t) return;
    setL("topic_blocklist", [...(limits.topic_blocklist ?? []), t]);
    setNewTopic("");
  }

  function removeTopic(i: number) {
    setL("topic_blocklist", (limits.topic_blocklist ?? []).filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { limits });
      onUpdated(d);
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const SaveBtn = () => !readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* ── Performance limits ───────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Performance Limits" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "#f0f7ff", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#1e40af" }}>
          Hard limits enforced by code. Leave blank to use the global default.
        </div>
        <div style={{ padding: 16 }}>
          <NumField label="Max tool calls per request" hint="LLM ↔ tool round-trips limit (default: 6, max: 20)" value={limits.max_tool_calls} onChange={v => setNum("max_tool_calls", v)} placeholder="6" readonly={readonly} />
          <NumField label="Max history messages" hint="Most recent N messages sent to LLM (default: unlimited, max: 100)" value={limits.max_history_messages} onChange={v => setNum("max_history_messages", v)} placeholder="unlimited" readonly={readonly} />
          <NumField label="LLM timeout (ms)" hint="Wait time before giving up (default: 60000, range: 5000–120000)" value={limits.timeout_ms} onChange={v => setNum("timeout_ms", v)} placeholder="60000" readonly={readonly} />
          <NumField label="Max response words" hint="Truncate bot responses longer than this (default: unlimited, max: 2000)" value={limits.max_response_words} onChange={v => setNum("max_response_words", v)} placeholder="unlimited" readonly={readonly} />
        </div>
      </Card>

      {/* ── Fallback message ─────────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Fallback Message" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "#f0f7ff", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#1e40af" }}>
          Returned when the tool-call budget is exhausted or the agent fails to complete. Leave blank for the default summary behaviour.
        </div>
        <div style={{ padding: 16 }}>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            value={limits.fallback_message ?? ""}
            onChange={e => setL("fallback_message", e.target.value || undefined)}
            placeholder="I wasn't able to complete that request. Please try rephrasing or contact support."
            disabled={readonly}
          />
        </div>
      </Card>

      {/* ── Tool-only mode ───────────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Tool-Only Mode" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "#fff8e1", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#92400e" }}>
          <strong>Hard enforcement:</strong> if the agent produces a response without calling any tool, the response is discarded and the refusal message is returned instead. Prevents the bot from answering from general knowledge.
          <br /><strong>Note:</strong> also blocks helpful clarifications like "what does deductible mean?" — pair with Domain Scope for a better experience.
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <ToggleField label="Enable tool-only mode" value={!!limits.tool_only_mode} onChange={v => setL("tool_only_mode", v)} readonly={readonly} />
          {limits.tool_only_mode && (
            <Field label="Refusal message" hint="Shown when bot answers without a tool call">
              <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56 }} value={limits.tool_only_refusal ?? ""} onChange={e => setL("tool_only_refusal", e.target.value || undefined)} placeholder="I can only answer questions using the available data tools for your account." disabled={readonly} />
            </Field>
          )}
        </div>
      </Card>

      {/* ── Domain scope enforcement ─────────────────────────────────────── */}
      <Card>
        <SectionHead title="Domain Scope Enforcement" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "#fff8e1", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#92400e" }}>
          <strong>Hard enforcement:</strong> before the agent runs, the LLM classifies the user's question against your domain description. Out-of-scope questions return the refusal message without calling the agent. Allows domain clarifications ("what does deductible mean?") while blocking general knowledge questions.
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <ToggleField label="Enable scope enforcement" value={!!limits.scope_enforcement} onChange={v => setL("scope_enforcement", v)} readonly={readonly} />
          {limits.scope_enforcement && (
            <>
              <Field label="Domain description" hint="The LLM classifies each question against this. Be specific about what topics are in scope.">
                <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 72 }} value={limits.scope_description ?? ""} onChange={e => setL("scope_description", e.target.value || undefined)} placeholder="This bot helps members with health insurance — policies, claims, benefits, deductibles, coverage and account details." disabled={readonly} />
              </Field>
              <Field label="Out-of-scope message">
                <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56 }} value={limits.out_of_scope_message ?? ""} onChange={e => setL("out_of_scope_message", e.target.value || undefined)} placeholder="I can only help with questions about your insurance account." disabled={readonly} />
              </Field>
              <NumField label="Context messages for classification" hint="How many recent messages to include so follow-up questions are classified correctly (1–10, default: 4)" value={limits.scope_context_messages} onChange={v => setNum("scope_context_messages", v)} placeholder="4" readonly={readonly} />
            </>
          )}
        </div>
      </Card>

      {/* ── Topic blocklist ──────────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Topic Blocklist" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "#fff8e1", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#92400e" }}>
          <strong>Hard enforcement (pre-LLM):</strong> if the user's message contains any of these phrases, the refusal message is returned immediately without calling the LLM at all. Fastest and most reliable block.
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {!readonly && (
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...inputStyle, flex: 1 }} value={newTopic} onChange={e => setNewTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }} placeholder="e.g. prime minister, stock price, weather" />
              <Btn onClick={addTopic} disabled={!newTopic.trim()}>+ Add</Btn>
            </div>
          )}
          {(limits.topic_blocklist ?? []).length === 0 && (
            <div style={{ fontSize: 12, color: C.muted }}>No blocked topics — all queries pass to the LLM.</div>
          )}
          {(limits.topic_blocklist ?? []).map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.bg, fontSize: 13 }}>
              <span>{t}</span>
              {!readonly && (
                <button onClick={() => removeTopic(i)} style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.danger; (e.currentTarget as HTMLButtonElement).style.borderColor = C.danger; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.muted; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}>×</button>
              )}
            </div>
          ))}
          {(limits.topic_blocklist ?? []).length > 0 && limits.out_of_scope_message === undefined && (
            <div style={{ fontSize: 12, color: "#92400e", background: "#fff8e1", padding: "6px 10px", borderRadius: C.radius, border: "1px solid #fcd34d" }}>
              ⚠ Set an "out-of-scope message" in Domain Scope Enforcement to customise what the bot says when a blocked topic is detected.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function NumField({ label, hint, value, onChange, placeholder, readonly }: {
  label: string; hint: string; value: number | undefined;
  onChange: (v: string) => void; placeholder: string; readonly: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" style={inputStyle} value={value ?? ""} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={readonly} />
    </Field>
  );
}

function ToggleField({ label, value, onChange, readonly }: { label: string; value: boolean; onChange: (v: boolean) => void; readonly: boolean }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: readonly ? "default" : "pointer" }}>
      <input type="checkbox" checked={value} onChange={e => !readonly && onChange(e.target.checked)} disabled={readonly} style={{ width: 15, height: 15, accentColor: C.primary }} />
      <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
    </label>
  );
}
