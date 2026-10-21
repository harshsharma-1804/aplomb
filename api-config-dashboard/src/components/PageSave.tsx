import { saveBeforeLeaving } from "./saveBeforeLeaving";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, CircleCheck, CircleAlert, X } from "lucide-react";
import { useLocation, useBlocker, UNSAFE_NavigationContext } from "react-router-dom";
import { Modal, Btn, ErrorBanner } from "./index";

type Change = {label:string;from:string;to:string};
type Entry = {changes:Change[];save:()=>Promise<void>;disabled:boolean;header:boolean;discard:()=>void};
const HeaderContext = createContext<Element|null>(null);
export function PageHeaderActions({children}:{children:React.ReactNode}) { const target=useContext(HeaderContext); return target ? createPortal(<div className="ui-row app-header-actions">{children}</div>,target) : null; }
const LeaveContext=createContext<(action:()=>void)=>void>(action=>action());
export function useGuardedAction(){return useContext(LeaveContext);}
const SaveContext = createContext<((id:string,entry:Entry|null)=>void)|null>(null);
const secret = /password|secret|token|credential|api.?key|db.?url|plain.?value|static.?headers|sample/i;
function value(v:unknown, key:string):string {
  if (v === undefined || v === null || v === "") return "empty";
  if (secret.test(key)) return "••••••••";
  if (typeof v === "boolean") return v ? "On" : "Off";
  return typeof v === "object" ? JSON.stringify(v,null,2) : String(v);
}
export function changesBetween(before:Record<string,unknown>,after:Record<string,unknown>):Change[] {
  return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k])).map(k=>({label:k.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ").replace(/^./,s=>s.toUpperCase()),from:value(before[k],k),to:value(after[k],k)}));
}
/** Tracks the actual editor state, including added/removed rows and Monaco values. */
export function usePageSave(draft:Record<string,unknown>,save:()=>Promise<void>,options:{enabled?:boolean;ready?:boolean;disabled?:boolean;resetKey?:string;header?:boolean}={}) {
  const register=useContext(SaveContext),id=useId();
  const serialized=JSON.stringify(draft), ready=options.ready!==false;
  const [baseline,setBaseline]=useState<string|null>(ready ? serialized : null);
  const resetKey=useRef(options.resetKey);
  useEffect(()=>{if(resetKey.current!==options.resetKey){resetKey.current=options.resetKey;setBaseline(ready ? serialized : null);}},[options.resetKey,ready,serialized]);
  const latest=useRef({serialized,save}); latest.current={serialized,save};
  const execute=useCallback(async()=>{const snapshot=latest.current.serialized;await latest.current.save();setBaseline(snapshot);},[]);
  useEffect(()=>{if(ready && baseline===null)setBaseline(serialized);},[ready,baseline,serialized]);
  useEffect(()=>{if(!register)return;register(id,options.enabled!==false && ready && baseline!==null ? {changes:changesBetween(JSON.parse(baseline),JSON.parse(serialized)),save:execute,disabled:!!options.disabled,header:options.header!==false,discard:()=>setBaseline(serialized)}:null);return()=>register(id,null);},[register,id,serialized,baseline,ready,options.enabled,options.disabled,options.header,execute]);
}
export function notifyToast(message:string,tone:"success"|"danger"="success",detail="") {
  window.dispatchEvent(new CustomEvent("dashboard:toast",{detail:{message,tone,detail}}));
}
export function PageSaveProvider({children}:{children:React.ReactNode}) {
  const [entries,setEntries]=useState<Record<string,Entry>>({});
  const register=useCallback((id:string,entry:Entry|null)=>setEntries(prev=>{const next={...prev};if(entry)next[id]=entry;else delete next[id];return next;}),[]);
  const [target,setTarget]=useState<Element|null>(null),[review,setReview]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  const [saveTarget,setSaveTarget]=useState<Element|null>(null);
  const [toasts,setToasts]=useState<{id:number;message:string;tone:"success"|"danger";detail:string}[]>([]);
  const location=useLocation();
  useEffect(()=>{setReview(false);setError("");},[location.pathname]);
  useEffect(()=>{
    const find=()=>{const heads=document.querySelectorAll(".app-content .ui-pagehead");setTarget(document.querySelector(".app-content .app-endpoint-head") ?? (heads.length ? heads[heads.length-1] : null));setSaveTarget(document.querySelector(".app-content [data-page-save-target]"));};
    find();const observer=new MutationObserver(find);observer.observe(document.getElementById("root")!,{childList:true,subtree:true});return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const handler=(event:Event)=>{const data=(event as CustomEvent).detail;const id=Date.now()+Math.random();setToasts(prev=>[...prev.filter(t=>t.message!==data.message),{...data,id}].slice(-3));setTimeout(()=>setToasts(prev=>prev.filter(t=>t.id!==id)),data.tone==="danger" ? 6500 : 2800);};
    window.addEventListener("dashboard:toast",handler);return()=>window.removeEventListener("dashboard:toast",handler);
  },[]);
  const all=Object.values(entries),dirty=all.filter(e=>e.changes.length),changes=dirty.flatMap(e=>e.changes);
  const [pending,setPending]=useState<(()=>void)|null>(null),[leaveSaving,setLeaveSaving]=useState(false);
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const blocker=useBlocker(({currentLocation,nextLocation})=>dirtyRef.current.length>0 && (currentLocation.pathname!==nextLocation.pathname || currentLocation.search!==nextLocation.search || currentLocation.hash!==nextLocation.hash));
  const guard=useCallback((action:()=>void)=>{if(dirtyRef.current.length)setPending(()=>action);else action();},[]);
  const {navigator}=useContext(UNSAFE_NavigationContext);
  // Descendant Routes use the navigator directly; guard those imperative moves too.
  useEffect(()=>{const push=navigator.push,replace=navigator.replace,go=navigator.go;
    navigator.push=(...args)=>guard(()=>push(...args));
    navigator.replace=(...args)=>guard(()=>replace(...args));
    navigator.go=(...args)=>guard(()=>go(...args));
    return()=>{navigator.push=push;navigator.replace=replace;navigator.go=go;};
  },[navigator,guard]);
  useEffect(()=>{if(!dirty.length)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty.length]);
  const leaving=blocker.state==="blocked" || !!pending;
  function stay(){if(leaveSaving)return;if(blocker.state==="blocked")blocker.reset();setPending(null);}
  function continueLeaving(){dirtyRef.current=[];const action=pending;setPending(null);if(blocker.state==="blocked")blocker.proceed();else action?.();}
  async function saveAndLeave(){setLeaveSaving(true);try{await saveBeforeLeaving(dirtyRef.current,()=>{notifyToast("Changes saved");continueLeaving();});}catch(e){notifyToast(String(e).replace(/^Error: /,""),"danger","Changes could not be saved. Your draft is still open.");}finally{setLeaveSaving(false);}}
  const scope=target?.querySelector("h1")?.textContent ?? "Endpoint configuration";
  const count=changes.length,word=`${count} ${count===1 ? "change" : "changes"}`;
  async function commit(){setSaving(true);setError("");try{for(const entry of dirty)await entry.save();setReview(false);notifyToast(`${word} saved`,"success",scope);}catch(e){const message=String(e).replace(/^Error: /,"");setError(message);notifyToast(message,"danger","Changes could not be saved");}finally{setSaving(false);}}
  return <SaveContext.Provider value={register}><LeaveContext.Provider value={guard}><HeaderContext.Provider value={target}>{children}</HeaderContext.Provider></LeaveContext.Provider>
    {target && all.some(e=>e.header) && createPortal(<div className="app-common-save"><Btn disabled={!count || saving || all.some(e=>e.disabled)} onClick={()=>{setError("");setReview(true);}}><Check />{count ? `Save ${word}` : "Save changes"}</Btn></div>,saveTarget ?? target.querySelector("[data-page-save-slot]") ?? target)}
    {leaving && <Modal title="Unsaved changes" width={520} onClose={stay}><p className="ui-muted">You have unsaved changes. Save them before leaving, or discard them to continue.</p><div className="ui-modal__foot"><Btn variant="secondary" disabled={leaveSaving} onClick={stay}>Stay</Btn><Btn variant="secondary" disabled={leaveSaving} onClick={()=>{for(const entry of dirtyRef.current)entry.discard();continueLeaving();}}>Discard changes</Btn><Btn disabled={leaveSaving || dirty.some(e=>e.disabled)} onClick={saveAndLeave}>{leaveSaving ? "Saving…" : "Save and continue"}</Btn></div></Modal>}
    {review && <Modal title="Review changes" width={660} onClose={()=>!saving && setReview(false)}><p className="ui-muted" style={{marginBottom:14}}>You are about to save {word} to <strong>{scope}</strong>. Check each value before confirming.</p><div className="ui-diff"><div className="ui-diff__row ui-diff__head"><span>Setting</span><span>From</span><span/><span>To</span></div>{changes.map((c,i)=><div key={i} className="ui-diff__row"><span className="ui-diff__label">{c.label}</span><span className="ui-diff__from">{c.from}</span><ArrowRight/><span className="ui-diff__to">{c.to}</span></div>)}</div>{error && <ErrorBanner message={error}/>}<div className="ui-modal__foot"><Btn variant="secondary" disabled={saving} onClick={()=>setReview(false)}>Cancel</Btn><Btn disabled={saving || !count} onClick={commit}><Check/>{saving ? "Saving…" : "Confirm and save"}</Btn></div></Modal>}
    {createPortal(<div className="ui-toasts" aria-live="polite">{toasts.map(t=><div key={t.id} className={`ui-toast ui-toast--${t.tone}`} role={t.tone==="danger" ? "alert" : "status"}>{t.tone==="danger" ? <CircleAlert/> : <CircleCheck/>}<div className="ui-grow"><div style={{fontWeight:600}}>{t.message}</div>{t.detail && <div className="ui-muted" style={{fontSize:12}}>{t.detail}</div>}</div><button className="ui-iconbtn ui-iconbtn--sm" aria-label="Dismiss notification" onClick={()=>setToasts(prev=>prev.filter(x=>x.id!==t.id))}><X/></button></div>)}</div>,document.body)}
  </SaveContext.Provider>;
}
