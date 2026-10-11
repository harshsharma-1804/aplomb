import { CircleCheck, CircleAlert, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { AiBot, AiToolCall } from "../../../api/types";
import { Card, SectionHead, Btn, Spinner, ErrorBanner, C, Code } from "../../../components";

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

  return <div className="ui-stack">{error && <ErrorBanner message={error}/>}<Card><SectionHead title="Tool call audit" action={<Btn variant="secondary" size="sm" onClick={load}><RefreshCw/>Refresh</Btn>}/>{loading ? <Spinner/> : !calls.length ? <div className="ui-card__body ui-muted">No tool calls recorded for this bot yet.</div> : calls.map(c=><div key={c._id}><button className="ui-log app-log" aria-expanded={expanded===c._id} onClick={()=>setExpanded(expanded===c._id ? null : c._id)}>{c.outcome==="ok" ? <CircleCheck size={15} style={{color:"var(--success)"}}/> : <CircleAlert size={15} style={{color:OUTCOME_COLOR[c.outcome] ?? C.danger}}/>}<span className="ui-mono ui-truncate">{c.tool_name}</span><span className="ui-row"><span className="ui-bar"><i style={{width:`${Math.min(100,c.latency_ms/30)}%`}}/></span><span className="ui-mono ui-muted" style={{width:56,textAlign:"right"}}>{c.latency_ms} ms</span></span><span className="ui-muted ui-num" style={{fontSize:12}}>{new Date(c.created_at).toLocaleString(undefined,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span>{expanded===c._id ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}</button>{expanded===c._id && <div className="ui-card__body"><p className="ui-muted">User: {c.user_id || "—"} · {c.outcome}</p>{c.detail && <p>{c.detail}</p>}<Code title="Tool arguments" value={c.tool_args}/></div>}</div>)}</Card></div>;
}
