import { Plus, Info, ArrowUp, ArrowDown, X } from "lucide-react";
import { usePageSave } from "../../../components/PageSave";
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

  usePageSave({persona,rules},save,{enabled:!readonly,disabled:saving});

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
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  return (
    <div className="app-behaviour-grid">
      {error && <ErrorBanner message={error} />}

      {/* Persona */}
      <Card>
        <SectionHead
          title="Custom Persona / Identity"
          action={!readonly ? <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
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
          action={!readonly ? <Btn size="sm" pageSave onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div className="ui-card__body"><div className="ui-callout ui-callout--neutral"><Info/><span><strong>These are soft instructions</strong>, injected as the highest-priority section of the system prompt. For hard enforcement use the Limits tab.</span></div></div>

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
            <Btn variant="secondary" onClick={addRule} disabled={!newRule.trim() || rules.length >= 20}><Plus/>Add</Btn>
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
            <div key={i} className="ui-frow" style={{height:"auto",padding:"10px 6px 10px 12px",alignItems:"flex-start"}}>
              <span className="ui-count">{i+1}</span>
              <span style={{ flex: 1, fontSize: 13, wordBreak: "break-word" }}>{r}</span>
              {!readonly && (
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <RuleBtn onClick={() => moveRule(i, -1)} disabled={i === 0} title="Move up"><ArrowUp/></RuleBtn>
                  <RuleBtn onClick={() => moveRule(i, 1)} disabled={i === rules.length - 1} title="Move down"><ArrowDown/></RuleBtn>
                  <RuleBtn onClick={() => removeRule(i)} danger title="Remove"><X/></RuleBtn>
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
      aria-label={title}
      className={`ui-iconbtn ui-iconbtn--sm ${danger ? "is-danger" : ""}`}

    >{children}</button>
  );
}
