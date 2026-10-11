import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, TriangleAlert, Boxes, Sparkles, ShieldCheck, Clock, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import type { AiBot } from "../../../api/types";
import { Card, SectionHead, Btn, Confirm, ErrorBanner, Stat, Code, DeleteIcon } from "../../../components";
interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }
export function OverviewTab({ bot, onUpdated, readonly }: Props) {
  const navigate = useNavigate(); const [toggling, setToggling] = useState(false); const [deleteConfirm, setDeleteConfirm] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  async function toggleActive() { setToggling(true); setError(''); try { onUpdated(await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { is_active: !bot.is_active })); } catch (e) { setError(String(e)); } finally { setToggling(false); } }
  async function handleDelete() { try { await api.del(`/__config/admin/ai/bots/${bot._id}`); navigate('/bots'); } catch (e) { setError(String(e)); setDeleteConfirm(false); } }
  const mcpConfig = JSON.stringify({ mcpServers:{ orchestrator:{ url:`${window.location.origin}/mcp`, headers:{ 'X-Bot-Key':'<your-bot-key>' } } } },null,2);
  async function copy() { try { await navigator.clipboard.writeText(mcpConfig); setCopied(true); } catch { setError('Could not copy automatically. Select and copy the configuration below.'); } }
  return <div>
    {error && <ErrorBanner message={error} />}
    <div className="app-bot-stats"><Stat label={<><Boxes />Apps assigned</>} value={bot.allowed_app_ids.length} /><Stat label={<><Sparkles />Providers assigned</>} value={bot.allowed_provider_ids.length} /><Stat label={<><ShieldCheck />Guardrail rules</>} value={bot.rules.length} /><Stat label={<><Clock />Last used</>} value={<span style={{ fontSize:16 }}>{bot.last_used_at ? new Date(bot.last_used_at).toLocaleDateString(undefined,{ day:'numeric',month:'short' }) : 'Never'}</span>} /></div>
    {!bot.is_active && <div className="ui-callout ui-callout--warning" style={{marginBottom:16}}><TriangleAlert /><span>This bot is disabled. It cannot authenticate or call AI and MCP endpoints until you enable it.</span></div>}
    <div className="app-overview-grid"><Card><SectionHead title="Details" /><div className="ui-card__body"><dl className="ui-kv"><dt>Bot ID</dt><dd><span className="ui-path">{bot._id}</span></dd><dt>Created</dt><dd>{new Date(bot.created_at).toLocaleString()}</dd><dt>Last used</dt><dd>{bot.last_used_at ? new Date(bot.last_used_at).toLocaleString() : "Never"}</dd></dl><div className="ui-callout ui-callout--warning" style={{marginTop:16}}><TriangleAlert /><span>The API key is shown once at registration. If it is lost, delete this bot and register a new one. Send it as the <code>X-Bot-Key</code> header.</span></div></div></Card><Card><SectionHead title="MCP client configuration" /><div className="ui-card__body"><Code title="Claude Desktop, Cursor, VS Code, LangChain" value={mcpConfig} /></div></Card></div>
    {!readonly && <Card style={{ marginTop:18, borderColor:'color-mix(in srgb,var(--danger) 30%,var(--border))' }}><SectionHead title="Danger zone" /><div className="app-status-strip"><div className="ui-grow"><strong>Delete this bot</strong><p className="ui-hint">Permanently deletes the bot and revokes its key immediately. Cannot be undone.</p></div><DeleteIcon onClick={() => setDeleteConfirm(true)} label="Delete bot" /></div></Card>}
    {deleteConfirm && <Confirm message={`Delete bot "${bot.name}"? Its API key stops working immediately.`} danger onCancel={() => setDeleteConfirm(false)} onConfirm={handleDelete} />}
  </div>;
}
