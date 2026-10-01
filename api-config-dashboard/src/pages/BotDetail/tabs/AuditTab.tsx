import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { AiBot, AiToolCall } from "../../../api/types";
import { Card, SectionHead, Btn, Spinner, ErrorBanner, C } from "../../../components";

interface Props { bot: AiBot; }

const OUTCOME_COLOR: Record<string, string> = {
  ok:              "var(--success)",
  tool_error:      "var(--warning)",
  scope_violation: "var(--danger)",
  denied:          "var(--danger)",
};

export function AuditTab({ bot }: Props) {
  const [calls, setCalls]   = useState<AiToolCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError("");
    try {
      const d = await api.get<{ results: AiToolCall[] }>(`/__config/admin/ai/tool-calls?bot_id=${bot._id}&limit=100`);
      setCalls(d.results);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [bot._id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title={`Tool Call Audit — ${bot.name}`}
          action={<Btn size="sm" variant="ghost" onClick={load}>Refresh</Btn>}
        />

        {loading ? <div style={{ padding: 24 }}><Spinner /></div> : (
          <div style={{ padding: "8px 16px" }}>
            {calls.length === 0 && (
              <div style={{ padding: "24px 0", fontSize: 13, color: C.muted, textAlign: "center" }}>No tool calls recorded for this bot yet.</div>
            )}
            {calls.map(c => (
              <div key={c._id} style={{ borderBottom: `1px solid ${C.border}`, padding: "8px 0" }}>
                <div
                  style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}
                  onClick={() => setExpanded(expanded === c._id ? null : c._id)}
                >
                  <span style={{
                    fontWeight: 700, fontSize: 11, padding: "2px 7px", borderRadius: 99,
                    background: OUTCOME_COLOR[c.outcome] + "15",
                    color: OUTCOME_COLOR[c.outcome] ?? C.text,
                    border: `1px solid ${OUTCOME_COLOR[c.outcome] ?? C.border}50`,
                    whiteSpace: "nowrap",
                  }}>{c.outcome}</span>
                  <code style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.tool_name}</code>
                  <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{c.latency_ms}ms</span>
                  <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>{new Date(c.created_at).toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{expanded === c._id ? "▲" : "▼"}</span>
                </div>

                {expanded === c._id && (
                  <div style={{ marginTop: 8, paddingLeft: 8, fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div><span style={{ color: C.muted, fontWeight: 600 }}>User:</span> {c.user_id || "—"}</div>
                    {c.detail && <div style={{ color: OUTCOME_COLOR[c.outcome] ?? C.text }}><span style={{ color: C.muted, fontWeight: 600 }}>Detail:</span> {c.detail}</div>}
                    <div>
                      <span style={{ color: C.muted, fontWeight: 600 }}>Args:</span>
                      <pre style={{ margin: "4px 0 0", background: C.bg, padding: "6px 10px", borderRadius: 4, fontSize: 11, overflowX: "auto" }}>
                        {JSON.stringify(c.tool_args, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
