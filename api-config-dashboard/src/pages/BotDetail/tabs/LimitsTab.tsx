import { usePageSave } from "../../../components/PageSave";
import { useState } from "react";
// ScopeArgNameInput also uses useState — same import
import { api } from "../../../api/client";
import type { AiBot, BotLimits, ScopeGuardConfig } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C, DeleteIcon } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function LimitsTab({ bot, onUpdated, readonly }: Props) {
  const [limits, setLimits] = useState<BotLimits>(bot.limits ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [saved, setSaved]   = useState(false);
  const [newTopic, setNewTopic] = useState("");

  usePageSave(limits as Record<string,unknown>,save,{enabled:!readonly,disabled:saving});

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
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  const SaveBtn = () => !readonly ? <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* ── Performance limits ───────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Performance Limits" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "var(--selection)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--primary)" }}>
          Hard limits enforced by code. Leave blank to use the global default.
        </div>
        <div style={{ padding: 16 }}>
          <NumField label="Max tool calls per request" hint="LLM ↔ tool round-trips limit (default: 6, max: 20)" value={limits.max_tool_calls} onChange={v => setNum("max_tool_calls", v)} placeholder="6" readonly={readonly} />
          <NumField label="Max history messages" hint="Most recent N messages sent to LLM (default: unlimited, max: 100)" value={limits.max_history_messages} onChange={v => setNum("max_history_messages", v)} placeholder="unlimited" readonly={readonly} />
          <NumField label="LLM timeout (ms)" hint="Wait time before giving up (default: 60000, range: 5000–120000)" value={limits.timeout_ms} onChange={v => setNum("timeout_ms", v)} placeholder="60000" readonly={readonly} />
          <NumField label="Max response words" hint="Truncate bot responses longer than this (default: unlimited, max: 2000)" value={limits.max_response_words} onChange={v => setNum("max_response_words", v)} placeholder="unlimited" readonly={readonly} />
          <NumField label="Rate limit (req/min)" hint="Max /__ai/chat + /mcp requests per minute — abuse protection (0 = unlimited)" value={limits.rate_limit_per_min} onChange={v => setNum("rate_limit_per_min", v)} placeholder="unlimited" readonly={readonly} />
        </div>
      </Card>

      {/* ── Fallback message ─────────────────────────────────────────────── */}
      <Card>
        <SectionHead title="Fallback Message" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "var(--selection)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--primary)" }}>
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
        <div style={{ padding: "10px 16px", background: "var(--warning-background)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--warning)" }}>
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
        <div style={{ padding: "10px 16px", background: "var(--warning-background)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--warning)" }}>
          <strong>Hard enforcement:</strong> before the agent runs, the LLM classifies the user's question against your domain description. Out-of-scope questions return the refusal message without calling the agent. Allows domain clarifications ("what does deductible mean?") while blocking general knowledge questions.
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <ToggleField label="Enable scope enforcement" value={!!limits.scope_enforcement} onChange={v => setL("scope_enforcement", v)} readonly={readonly} />
          {limits.scope_enforcement && (
            <>
              <Field label="Domain description" hint="Short summary used when no full classification prompt is set (2–4 sentences). Wrapped automatically as: 'Domain: …'">
                <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 60 }} value={limits.scope_description ?? ""} onChange={e => setL("scope_description", e.target.value || undefined)} placeholder="This bot helps members with health insurance — policies, claims, benefits, deductibles, coverage and account details." disabled={readonly} />
              </Field>

              <Field
                label="Full classification prompt (optional)"
                hint="When set, this replaces the entire system message of the classification call. Write your full YES/NO rubric here — rules, examples, categories. The model must return YES (in scope) or NO (out of scope). Takes precedence over the domain description above."
              >
                <textarea
                  style={{ ...inputStyle, resize: "vertical", minHeight: 200, fontFamily: "monospace", fontSize: 12 }}
                  value={limits.scope_classification_prompt ?? ""}
                  onChange={e => setL("scope_classification_prompt", e.target.value || undefined)}
                  placeholder={`You are a domain classifier for a health insurance bot.\nAnswer only YES (in scope) or NO (out of scope).\n\nIN SCOPE examples:\n- What is a deductible?\n- Show my claims\n- What is my policy?\n\nOUT OF SCOPE examples:\n- Who is the prime minister?\n- What is Python?\n\nAnswer YES or NO only.`}
                  disabled={readonly}
                />
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
        <div style={{ padding: "10px 16px", background: "var(--warning-background)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--warning)" }}>
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
                <DeleteIcon onClick={() => removeTopic(i)} style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, color: C.muted, cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = C.danger; (e.currentTarget as HTMLButtonElement).style.borderColor = C.danger; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.muted; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }} label="Remove item" />
              )}
            </div>
          ))}
          {(limits.topic_blocklist ?? []).length > 0 && limits.out_of_scope_message === undefined && (
            <div style={{ fontSize: 12, color: "var(--warning)", background: "var(--warning-background)", padding: "6px 10px", borderRadius: C.radius, border: "1px solid var(--warning)" }}>
              ⚠ Set an "out-of-scope message" in Domain Scope Enforcement to customise what the bot says when a blocked topic is detected.
            </div>
          )}
        </div>
      </Card>

      {/* ── User Scope Guard ─────────────────────────────────────────────── */}
      <Card>
        <SectionHead title="User Scope Guard" action={<SaveBtn />} />
        <div style={{ padding: "10px 16px", background: "var(--selection)", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "var(--primary)" }}>
          <strong>Disabled by default</strong> — the upstream API is the real authority on data access (it will reject unauthorised requests regardless). Enable this if you want the orchestrator to also pre-block cross-user tool calls and log them as <code>scope_violation</code> in the audit trail.
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <ToggleField
            label="Enable user scope guard"
            value={!!limits.scope_guard?.enabled}
            onChange={v => setL("scope_guard", { ...(limits.scope_guard ?? { id_arg_names: [] }), enabled: v })}
            readonly={readonly}
          />
          {limits.scope_guard?.enabled && (
            <>
              {/* ID arg names */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
                  User ID argument names
                  <span style={{ fontWeight: 400, marginLeft: 6 }}>— tool argument names that carry a user identifier (case-insensitive)</span>
                </div>
                {!readonly && (
                  <ScopeArgNameInput
                    current={limits.scope_guard.id_arg_names ?? []}
                    onChange={names => setL("scope_guard", { ...limits.scope_guard!, id_arg_names: names })}
                  />
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {(limits.scope_guard.id_arg_names ?? []).length === 0 && (
                    <span style={{ fontSize: 12, color: C.muted }}>No names configured — guard will not match any argument by name.</span>
                  )}
                  {(limits.scope_guard.id_arg_names ?? []).map((name, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.selection, border: `1px solid ${C.border}`, borderRadius: 99, padding: "2px 10px", fontSize: 12, fontWeight: 600, color: C.primary }}>
                      {name}
                      {!readonly && (
                        <DeleteIcon onClick={() => setL("scope_guard", { ...limits.scope_guard!, id_arg_names: (limits.scope_guard!.id_arg_names ?? []).filter((_, j) => j !== i) })}
                          style={{ background: "none", border: "none", cursor: "pointer", color: C.primary, fontSize: 13, lineHeight: 1, padding: 0 }} label="Remove item" />
                      )}
                    </span>
                  ))}
                </div>
              </div>

              {/* ID value pattern */}
              <Field
                label="User ID value pattern (regex, optional)"
                hint="Any tool argument whose value matches this regex is treated as a user ID, regardless of the argument name. Leave blank to rely on argument names only. Example: ^CUST-\d+ for retail."
              >
                <input
                  style={{ ...inputStyle, fontFamily: "monospace" }}
                  value={limits.scope_guard.id_value_pattern ?? ""}
                  onChange={e => setL("scope_guard", { ...limits.scope_guard!, id_value_pattern: e.target.value || undefined })}
                  placeholder="e.g. ^(MED|USR|EMP)[-_]?\w+"
                  disabled={readonly}
                />
                {limits.scope_guard.id_value_pattern && (() => {
                  try { new RegExp(limits.scope_guard.id_value_pattern!); return null; }
                  catch { return <div style={{ fontSize: 11, color: C.danger, marginTop: 3 }}>⚠ Invalid regex pattern</div>; }
                })()}
              </Field>

              {/* Deny message */}
              <Field label="Access denied message" hint="Returned to the LLM when a scope violation is detected. The LLM will relay this to the user.">
                <textarea
                  style={{ ...inputStyle, resize: "vertical", minHeight: 52 }}
                  value={limits.scope_guard.deny_message ?? ""}
                  onChange={e => setL("scope_guard", { ...limits.scope_guard!, deny_message: e.target.value || undefined })}
                  placeholder="Access denied — you can only access your own account data."
                  disabled={readonly}
                />
              </Field>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function ScopeArgNameInput({ current, onChange }: { current: string[]; onChange: (v: string[]) => void }) {
  const [val, setVal] = useState("");
  function add() {
    const t = val.trim();
    if (!t || current.includes(t)) return;
    onChange([...current, t]);
    setVal("");
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input style={{ ...inputStyle, flex: 1 }} value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        placeholder="e.g. memberId, userId, customerId" />
      <Btn onClick={add} disabled={!val.trim()}>+ Add</Btn>
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
