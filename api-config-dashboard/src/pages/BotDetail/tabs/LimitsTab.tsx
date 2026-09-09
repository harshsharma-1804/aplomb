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

  function set(key: keyof BotLimits, raw: string) {
    const val = raw === "" ? undefined : parseInt(raw, 10);
    setLimits(prev => ({ ...prev, [key]: isNaN(val as number) ? undefined : val }));
    setSaved(false);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title="Bot Limits"
          action={!readonly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save"}</Btn> : undefined}
        />
        <div style={{ padding: "10px 16px", background: "#f0f7ff", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: "#1e40af" }}>
          Leave a field blank to use the global default. Limits are clamped to safe ranges on save.
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 0 }}>

          <LimitField
            label="Max tool calls per request"
            hint="Maximum LLM ↔ tool round-trips in a single chat (global default: 6, max: 20)"
            value={limits.max_tool_calls}
            onChange={v => set("max_tool_calls", v)}
            min={1} max={20}
            placeholder="6"
            readonly={readonly}
          />

          <LimitField
            label="Max history messages"
            hint="Maximum messages from conversation history sent to the LLM (most recent kept, global default: unlimited, max: 100)"
            value={limits.max_history_messages}
            onChange={v => set("max_history_messages", v)}
            min={1} max={100}
            placeholder="unlimited"
            readonly={readonly}
          />

          <LimitField
            label="LLM request timeout (ms)"
            hint="How long to wait for the LLM to respond before giving up (global default: 60000, range: 5000–120000)"
            value={limits.timeout_ms}
            onChange={v => set("timeout_ms", v)}
            min={5000} max={120000}
            placeholder="60000"
            readonly={readonly}
          />
        </div>
      </Card>
    </div>
  );
}

function LimitField({ label, hint, value, onChange, min, max, placeholder, readonly }: {
  label: string; hint: string; value: number | undefined;
  onChange: (v: string) => void; min: number; max: number;
  placeholder: string; readonly: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        style={inputStyle}
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min} max={max}
        disabled={readonly}
      />
    </Field>
  );
}
