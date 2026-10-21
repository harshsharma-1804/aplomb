import { useEffect, useState } from "react";
import { ArrowRight, Search, RefreshCw, RotateCw } from "lucide-react";
import { api } from "../../../api/client";
import type { App, Endpoint, ListResult, VersionHistoryEntry } from "../../../api/types";
import { Btn, Card, Confirm, ErrorBanner, Field, MethodBadge, Spinner, Table } from "../../../components";
import { notifyToast } from "../../../components/PageSave";
import { useSession } from "../../../auth/SessionContext";

type Snapshot = {app:unknown;endpoints:unknown[]};
type DiffRow = {kind:"Added"|"Changed"|"Removed";method:string;path:string;summary:string};
function config(value:unknown):Record<string,unknown> {
  const {_id,id,created_at,updated_at,created_by,app_id,frontend_key_hash,frontend_key_set,...rest}=(value ?? {}) as Record<string,unknown>;
  if(frontend_key_hash!==undefined || frontend_key_set!==undefined)rest.frontend_key_set=frontend_key_set ?? !!frontend_key_hash;
  return rest;
}
const titles:Record<string,string>={field_mappings:"Field mappings",upstream:"Upstream",request:"Request contract",output_schema:"Response schema",query_params:"Query parameters",path_params:"Path parameters",sample_response:"Sample response",script_mode:"Script mode",script_file_id:"Script file",app_env:"Environment variables",session_config:"Sessions",allowed_provider_ids:"Identity providers"};
function differing(a:Record<string,unknown>,b:Record<string,unknown>) {return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>titles[k] ?? k.replace(/_/g," ").replace(/^./,c=>c.toUpperCase()));}
export function compareSnapshots(before:Snapshot,after:Snapshot):DiffRow[] {
  const map=(s:Snapshot)=>Object.fromEntries(s.endpoints.map(ep=>{const e=ep as Record<string,unknown>;return [`${e.method} ${e.path}`,config(ep)];}));
  const a=map(before),b=map(after),out:DiffRow[]=[];
  for(const key of new Set([...Object.keys(a),...Object.keys(b)])) {const space=key.indexOf(" "),method=key.slice(0,space),path=key.slice(space+1);if(!a[key])out.push({kind:"Added",method,path,summary:"New endpoint"});else if(!b[key])out.push({kind:"Removed",method,path,summary:"Endpoint removed"});else {const fields=differing(a[key],b[key]);if(fields.length)out.push({kind:"Changed",method,path,summary:fields.join(", ")});}}
  const appFields=differing(config(before.app),config(after.app));if(appFields.length)out.push({kind:"Changed",method:"",path:"App settings",summary:appFields.join(", ")});return out;
}
function ChangeBadge({kind,children}:{kind:DiffRow["kind"];children?:React.ReactNode}) {return <span className={`ui-badge ${kind==="Added" ? "ui-badge--success" : kind==="Changed" ? "ui-badge--warning" : ""}`}>{children ?? kind}</span>;}
export function HistorySection({appId,compare,onRestored}:{appId:string;compare:boolean;onRestored:()=>void}) {
  const {can}=useSession();
  const [entries,setEntries]=useState<VersionHistoryEntry[]>([]),[current,setCurrent]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState("");
  const [base,setBase]=useState(""),[target,setTarget]=useState("current"),[restore,setRestore]=useState<VersionHistoryEntry|null>(null),[saving,setSaving]=useState(false);
  async function load(){setLoading(true);setError("");try{const [history,app,endpoints]=await Promise.all([api.get<ListResult<VersionHistoryEntry>>(`/__config/apps/${appId}/history`),api.get<App>(`/__config/apps/${appId}`),api.get<ListResult<Endpoint>>(`/__config/apps/${appId}/endpoints`)]);setEntries(history.results);setCurrent({app,endpoints:endpoints.results});setBase(prev=>prev || history.results[0]?._id || "");}catch(e){setError(String(e));}finally{setLoading(false);}}
  useEffect(()=>{load();},[appId]);
  if(loading)return <Spinner/>;
  const left=entries.find(e=>e._id===base)?.snapshot,right=target==="current" ? current : entries.find(e=>e._id===target)?.snapshot;
  const diff=left && right ? compareSnapshots(left,right) : [];
  const date=(v:string)=>new Date(v).toLocaleString(undefined,{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
  const label=(e:VersionHistoryEntry)=>`${date(e.created_at)} · ${e.description || e.change_type}`;
  return <>{error && <ErrorBanner message={error}/>} {compare ? <>
    <Card><div className="ui-card__body app-compare-selectors"><Field label="Base snapshot"><select className="ui-select" value={base} onChange={e=>setBase(e.target.value)}>{!entries.length && <option value="">No snapshots</option>}{entries.map(e=><option key={e._id} value={e._id}>{label(e)}</option>)}</select></Field><ArrowRight size={16} className="ui-faint" style={{marginBottom:10}}/><Field label="Compare with"><select className="ui-select" value={target} onChange={e=>setTarget(e.target.value)}><option value="current">Current version</option>{entries.map(e=><option key={e._id} value={e._id}>{label(e)}</option>)}</select></Field></div></Card>
    <Card><div className="ui-card__head"><h2 className="ui-card__title ui-row">Changes<ChangeBadge kind="Added">{diff.filter(d=>d.kind==="Added").length} added</ChangeBadge><ChangeBadge kind="Changed">{diff.filter(d=>d.kind==="Changed").length} changed</ChangeBadge><ChangeBadge kind="Removed">{diff.filter(d=>d.kind==="Removed").length} removed</ChangeBadge></h2></div><Table cols={[{key:"kind",label:"Change",render:v=><ChangeBadge kind={v as DiffRow["kind"]}/>},{key:"path",label:"Endpoint",render:(v,r)=><span className="ui-row">{!!r.method && <MethodBadge method={String(r.method)}/>}<span className="ui-mono">{String(v)}</span></span>},{key:"summary",label:"What differs",render:v=><span className="ui-muted">{String(v)}</span>}]} rows={diff as unknown as Record<string,unknown>[]}/></Card>
  </> : <Card><div className="ui-card__head"><h2 className="ui-card__title ui-row"><span className="ui-count">{entries.length}</span>{entries.length===1 ? "snapshot" : "snapshots"}</h2><div className="ui-row"><div className="ui-search" style={{width:240}}><Search/><input className="ui-input ui-input--sm" aria-label="Filter snapshots" placeholder="Filter snapshots" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="ui-iconbtn ui-iconbtn--bordered" aria-label="Refresh snapshots" onClick={load}><RefreshCw/></button></div></div><Table cols={[{key:"description",label:"Change",render:(_,r)=>{const description=String(r.description || r.change_type),match=description.match(/^(.*?)(?::\s*)?\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/.*)$/);return match ? <span className="ui-row"><strong style={{fontWeight:600}}>{match[1].replace(/:\s*$/,"")}</strong><span className="ui-mono ui-muted">{match[2]} {match[3]}</span></span> : <strong style={{fontWeight:600}}>{description}</strong>;}},{key:"changed_by",label:"By",render:v=><span className="ui-muted">{(v as VersionHistoryEntry["changed_by"])?.username ?? "—"}</span>},{key:"created_at",label:"When",render:v=><span className="ui-muted ui-num">{date(String(v))}</span>},{key:"_id",label:"",render:(_,r)=>can("rollback") && <Btn variant="ghost" size="sm" disabled={saving} onClick={()=>setRestore(r as unknown as VersionHistoryEntry)}><RotateCw/>Roll back</Btn>}]} rows={entries.filter(e=>`${e.description} ${e.change_type} ${e.changed_by?.username}`.toLowerCase().includes(query.toLowerCase())) as unknown as Record<string,unknown>[]}/></Card>}
    {restore && <Confirm danger message={`Restore the snapshot from ${date(restore.created_at)}? This replaces this app’s current configuration and endpoints.`} onCancel={()=>setRestore(null)} onConfirm={async()=>{setSaving(true);try{await api.post(`/__config/apps/${appId}/rollback`,{snapshot_id:restore._id});setRestore(null);notifyToast("Snapshot restored");await load();onRestored();}catch(e){setError(String(e));}finally{setSaving(false);}}}/>}
  </>;
}
