import { useState } from "react";
import { api } from "../../../api/client";
import type { AiBot } from "../../../api/types";
import { Card, SectionHead, Btn, Field, inputStyle, ErrorBanner, C } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function BehaviourTab({ bot, onUpdated, readonly }: Props) {
  const [rules, setRules]     = useState<string[]>(bot.rules ?? []);
  const [persona, setPersona] = useState(bot.persona ?? "");
  const [newRule, setNewRule] = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [saved, setSaved]     = useState(false);

  function addRule() {
    const trimmed = newRule.trim();
    if (!trimmed || rules.length >= 20) return;
    setRules([...rules, trimmed]);
    setNewRule("");
    setSaved(false);
  }

  function removeRule(i: number) {
    setRules(rules.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  function moveRule(i: number, dir: -1 | 1) {
    const next = [...rules];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRules(next);
    setSaved(false);
  }

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { rules, persona });
      onUpdated(d);
      setSaved(true);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      {/* Persona */}
      <Card>
        <SectionHead
          title="Custom Persona / Identity"
          action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div style={{ padding: 16 }}>
          <Field label="Instructions / Persona" hint="Replaces the default 'You are an API assistant…' opener. Describe who the bot is and what it specialises in. Leave blank to use the default.">
            <textarea
              style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
              value={persona}
              onChange={e => { setPersona(e.target.value); setSaved(false); }}
              placeholder="You are a health insurance assistant for Acme Insurance. You help members understand their policies and claims. Keep answers concise and friendly."
              disabled={readonly}
            />
          </Field>
        </div>
      </Card>

      {/* Rules */}
      <Card>
        <SectionHead
          title={`Guardrail Rules (${rules.length}/20)`}
          action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: "var(--warning-background)", fontSize: 12, color: "var(--warning)" }}>
          <strong>These are soft instructions</strong> — injected as the highest-priority section of the system prompt. The model is guided but not code-blocked by these. For hard enforcement (topic blocking, scope filtering, tool-only mode) use the <strong>Limits</strong> tab.
        </div>

        {/* Add rule */}
        {!readonly && (
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={newRule}
              onChange={e => setNewRule(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addRule())}
              placeholder="e.g. Only answer questions about insurance policies and claims"
              disabled={rules.length >= 20}
              maxLength={500}
            />
            <Btn onClick={addRule} disabled={!newRule.trim() || rules.length >= 20}>+ Add</Btn>
          </div>
        )}

        {/* Rules list */}
        <div style={{ padding: "8px 16px" }}>
          {rules.length === 0 && (
            <div style={{ padding: "16px 0", fontSize: 13, color: C.muted, textAlign: "center" }}>
              No rules yet. Add rules to constrain the bot's behaviour.
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Examples: "Only answer questions about policies and claims" · "Never provide legal or medical advice" · "Always respond in English"
              </div>
            </div>
          )}
          {rules.map((r, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "8px 10px", marginBottom: 6,
              border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.bg,
            }}>
              <span style={{ minWidth: 22, color: C.muted, fontWeight: 700, fontSize: 12, paddingTop: 1 }}>{i + 1}.</span>
              <span style={{ flex: 1, fontSize: 13, wordBreak: "break-word" }}>{r}</span>
              {!readonly && (
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <RuleBtn onClick={() => moveRule(i, -1)} disabled={i === 0} title="Move up">↑</RuleBtn>
                  <RuleBtn onClick={() => moveRule(i, 1)} disabled={i === rules.length - 1} title="Move down">↓</RuleBtn>
                  <RuleBtn onClick={() => removeRule(i)} danger title="Remove">×</RuleBtn>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RuleBtn({ onClick, disabled, danger, children, title }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 24, height: 24, borderRadius: 4,
        border: `1px solid ${danger ? C.danger + "60" : C.border}`,
        background: "none", cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? C.muted : danger ? C.danger : C.text,
        fontSize: 13, lineHeight: 1, padding: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >{children}</button>
  );
}
