import { Lock, Sparkles, X } from "lucide-react";
import { usePageSave } from "../../../components/PageSave";
import { useState, useEffect } from "react";
import { api } from "../../../api/client";
import type { AiBot, AiProvider, App, AppPermission, AppPermissionsMap, ListResult } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, C, inputStyle, Toggle, Table } from "../../../components";

interface Props { bot: AiBot; onUpdated: (b: AiBot) => void; readonly: boolean; }

export function BindingsTab({ bot, onUpdated, readonly }: Props) {
  const [perms, setPerms]             = useState<AppPermissionsMap>(bot.app_permissions ?? {});
  const [providerIds, setProviderIds] = useState<string[]>(bot.allowed_provider_ids ?? []);
  const [apps, setApps]               = useState<App[]>([]);
  const [providers, setProviders]     = useState<AiProvider[]>([]);
  const [allBots, setAllBots]         = useState<AiBot[]>([]);
  const [providerSaving, setProviderSaving] = useState(false);
  const [error, setError]             = useState("");
  const [providerSaved, setProviderSaved] = useState(false);

  usePageSave({allowedProviderIds:providerIds},saveProviders,{enabled:!readonly,disabled:providerSaving});

  // Apps already assigned to OTHER bots (1-app:1-bot constraint)
  const takenAppIds = new Set(
    allBots.filter(b => b._id !== bot._id).flatMap(b => Object.keys(b.app_permissions ?? {}))
  );

  useEffect(() => {
    Promise.all([
      api.get<ListResult<App>>("/__config/apps"),
      api.get<{ results: AiProvider[] }>("/__config/admin/ai/providers"),
      api.get<{ results: AiBot[] }>("/__config/admin/ai/bots"),
    ]).then(([a, p, b]) => {
      setApps(a.results.filter(app => app.ai_expose && app.status === "active"));
      setProviders(p.results);
      setAllBots(b.results);
    }).catch(() => {});
  }, []);

  function togglePerm(appId:string,field:"read"|"write",val:boolean){setPerms(prev=>({...prev,[appId]:{...(prev[appId] ?? {read:true,write:true}),[field]:val}}));}
  function addApp(appId:string){setPerms(prev=>({...prev,[appId]:{read:true,write:true}}));}
  function removeApp(appId:string){setPerms(prev=>{const next={...prev};delete next[appId];return next;});}
  async function saveApps(){setProviderSaving(true);setError("");try{const updated=await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`,{app_permissions:perms});onUpdated(updated);}catch(e){setError(String(e));throw e;}finally{setProviderSaving(false);}}
  usePageSave({appPermissions:perms},saveApps,{enabled:!readonly,disabled:providerSaving});

  async function saveProviders() {
    setProviderSaving(true); setError(""); setProviderSaved(false);
    try {
      const d = await api.put<AiBot>(`/__config/admin/ai/bots/${bot._id}`, { allowed_provider_ids: providerIds });
      onUpdated(d);
      setProviderSaved(true);
    } catch (e: any) { setError(String(e)); throw e; }
    finally { setProviderSaving(false); }
  }

  const assignedApps = Object.entries(perms).filter(([, p]) => p.read || p.write);
  const unassignedApps = apps.filter(a => !perms[a._id] || (!perms[a._id]!.read && !perms[a._id]!.write));
  const availableToAdd = unassignedApps.filter(a => !takenAppIds.has(a._id));

  return <div className="ui-stack">{error && <ErrorBanner message={error}/>}
    <div className="ui-callout ui-callout--neutral"><Lock/><span>Deny by default: a bot can only access apps explicitly assigned here. Read covers GET endpoints; write covers POST, PUT, PATCH and DELETE.</span></div>
    <Card><div className="ui-card__head"><h2 className="ui-card__title ui-row">Allowed apps<span className="ui-count">{assignedApps.length}</span></h2>{!readonly && <select className="ui-select ui-select--sm" style={{width:200}} aria-label="Add app" value="" disabled={!availableToAdd.length} onChange={e=>e.target.value && addApp(e.target.value)}><option value="">{availableToAdd.length ? "Add app…" : "No available apps"}</option>{availableToAdd.map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select>}</div><Table cols={[{key:"appId",label:"App",render:v=>{const a=apps.find(a=>a._id===v);return <div><strong style={{fontWeight:600}}>{a?.name ?? String(v)}</strong><div className="ui-mono ui-muted">{a?.base_path}</div></div>;}},{key:"read",label:"Read",render:(v,r)=><input type="checkbox" checked={!!v} disabled={readonly} aria-label={`${apps.find(a=>a._id===r.appId)?.name ?? r.appId}: read`} onChange={e=>togglePerm(String(r.appId),"read",e.target.checked)}/>},{key:"write",label:"Write",render:(v,r)=><input type="checkbox" checked={!!v} disabled={readonly} aria-label={`${apps.find(a=>a._id===r.appId)?.name ?? r.appId}: write`} onChange={e=>togglePerm(String(r.appId),"write",e.target.checked)}/>},{key:"_actions",label:"",render:(_,r)=>!readonly && <button className="ui-iconbtn ui-iconbtn--danger" aria-label={`Remove app ${r.appId}`} onClick={()=>removeApp(String(r.appId))}><X/></button>}]} rows={assignedApps.map(([appId,p])=>({appId,...p}))}/></Card>
    <Card><div className="ui-card__head"><h2 className="ui-card__title ui-row">Allowed LLM providers<span className="ui-count">{providerIds.length}</span></h2>{!readonly && <select className="ui-select ui-select--sm" aria-label="Add provider" style={{width:200}} value="" onChange={e=>{const id=e.target.value;if(id)setProviderIds(prev=>[...prev,id]);}}><option value="">Add provider…</option>{providers.filter(p=>!providerIds.includes(p._id)).map(p=><option key={p._id} value={p._id}>{p.name}</option>)}</select>}</div><table className="ui-table"><tbody>{providerIds.map(pid=>{const p=providers.find(p=>p._id===pid);return <tr key={pid}><td><div className="ui-row" style={{gap:12}}><span className="ui-tile"><Sparkles/></span><div><strong style={{fontWeight:600}}>{p?.name ?? pid}</strong><div className="ui-mono ui-muted">{p?.model}</div></div></div></td><td className="ui-cell-actions">{!readonly && <button className="ui-iconbtn ui-iconbtn--danger" aria-label={`Remove provider ${p?.name ?? pid}`} onClick={()=>setProviderIds(prev=>prev.filter(id=>id!==pid))}><X/></button>}</td></tr>;})}{!providerIds.length && <tr><td className="ui-muted">No providers assigned — this bot cannot chat.</td></tr>}</tbody></table><div className="ui-card__foot">The first active provider in this list is used. Deactivated providers are skipped.</div></Card>
  </div>;
}
