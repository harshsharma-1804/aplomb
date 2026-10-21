import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, ChevronUp, Info, LoaderCircle, Ellipsis, Copy, X, Trash2 } from "lucide-react";

export const C = {
  bg: "var(--surface-muted)", canvas: "var(--canvas)", surface: "var(--surface)", surfaceMuted: "var(--surface-muted)",
  border: "var(--border)", borderStrong: "var(--input-border)",
  primary: "var(--primary)", primaryHover: "var(--primary-hover)", primaryText: "var(--primary-text)",
  danger: "var(--danger)", success: "var(--success)", warning: "var(--warning)", text: "var(--text)", muted: "var(--muted)",
  sidebar: "var(--sidebar)", sidebarHover: "var(--sidebar-hover)", sidebarText: "var(--sidebar-text)", sidebarTextMuted: "var(--sidebar-text-muted)",
  selection: "var(--selection)", dangerBg: "var(--danger-background)", successBg: "var(--success-background)", warningBg: "var(--warning-background)",
  codeBg: "var(--code-bg)", codeText: "var(--code-text)", overlay: "var(--overlay)", shadow: "var(--shadow)", shadowModal: "var(--shadow-modal)",
  radiusSm: "var(--radius-sm)", radius: "var(--radius)", radiusPanel: "var(--radius-panel)", radiusFeature: "var(--radius-feature)",
};
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "danger" | "ghost" | "outline" | "secondary" | "success"; size?: "sm" | "md"; pageSave?: boolean; }
export function Btn({ variant = "primary", size = "md", className = "", children, pageSave, ...rest }: BtnProps) {
  const cls = variant === "ghost" ? "quiet" : variant === "secondary" ? "" : variant;
  return <button type="button" data-page-save={pageSave || undefined} className={`ui-btn ${cls ? `ui-btn--${cls}` : ""} ${size === "sm" ? "ui-btn--sm" : ""} ${className}`} {...rest}>{children}</button>;
}
const tones: Record<string, string> = {
  active: "success", approved: "success", ok: "success", admin: "accent", sub_admin: "accent", denied: "danger", deprecated: "danger",
  pending: "warning", draft: "warning", disabled: "warning", inactive: "warning", "auth off":"warning",
};
export function Badge({ text }: { text: string }) {
  return <span className={`ui-badge ${tones[text.toLowerCase()] ? `ui-badge--${tones[text.toLowerCase()]}` : ""}`}>{tones[text.toLowerCase()] && <i className="ui-dot" />}{tones[text.toLowerCase()] ? text.replace(/_/g," ").replace(/^./,c=>c.toUpperCase()) : text.replace(/_/g," ")}</span>;
}
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="ui-card app-card" style={style}>{children}</div>;
}
export function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return <div className="ui-card__head"><h2 className="ui-card__title">{title}</h2><div className="ui-row ui-row--wrap">{action}</div></div>;
}
export function Table({ cols, rows, onRowClick }: {
  cols: { key: string; label: string; render?: (v: unknown, row: Record<string, unknown>) => React.ReactNode }[];
  rows: Record<string, unknown>[]; onRowClick?: (row: Record<string, unknown>) => void;
}) {
  return <div className="app-table-wrap"><table className="ui-table"><thead><tr>{cols.map(c => <th key={`${c.key}-${cols.indexOf(c)}`} scope="col">{c.label}</th>)}</tr></thead><tbody>
    {rows.length === 0 ? <tr><td colSpan={cols.length}><div className="app-empty">No records to display</div></td></tr> : rows.map((row, i) => <tr key={String(row._id ?? i)}>
      {cols.map((c, index) => <td key={`${c.key}-${index}`} className={!c.label || c.label.toLowerCase()==="actions" ? "ui-cell-actions" : undefined}>{index === 0 && onRowClick ? <button type="button" className="app-table-link" onClick={() => onRowClick(row)}>{c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "—")}</button> : c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "—")}</td>)}
    </tr>)}
  </tbody></table></div>;
}
export function Modal({ title, onClose, children, width = 520 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  const id = useId(); const ref = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const prior = opener.current;
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
    (controls().find(el => el.tagName === "INPUT") ?? controls()[0] ?? ref.current)?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close.current(); }
      if (e.key !== "Tab") return;
      const all = controls(); const first = all[0]; const last = all[all.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    ref.current?.addEventListener("keydown", handler);
    const node = ref.current;
    return () => { node?.removeEventListener("keydown", handler); prior?.focus(); };
  }, []);
  return createPortal(<div className="ui-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} style={{ width }}>
    <div className="ui-modal__head"><h2 className="ui-modal__title" id={id}>{title}</h2><button type="button" className="ui-iconbtn" onClick={onClose} aria-label="Close dialog"><X /></button></div>
    <div className="ui-modal__body">{children}</div>
  </div></div>, document.body);
}
export function Confirm({ message, onConfirm, onCancel, danger = false }: { message: string; onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  return <Modal title={danger ? "Confirm deletion" : "Confirm changes"} onClose={onCancel}><p className="app-confirm-message">{message}</p><div className="ui-row app-actions-end"><Btn variant="ghost" onClick={onCancel}>Cancel</Btn><Btn variant={danger ? "danger" : "primary"} onClick={onConfirm}>{danger ? "Delete" : "Confirm"}</Btn></div></Modal>;
}
export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: string }) {
  const uid = useId(); let content = children; let id: string | undefined;
  if (React.isValidElement(children) && ["input", "textarea", "select"].includes(String(children.type))) {
    id = children.props.id ?? uid;
    content = React.cloneElement(children as React.ReactElement, { id, "aria-describedby": hint ? `${uid}-hint` : children.props["aria-describedby"] });
  }
  return <div className="ui-field"><label className="ui-label" htmlFor={id}>{label}</label>{content}{hint && <p className="ui-hint" id={`${uid}-hint`}>{hint}</p>}</div>;
}
export const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 11px", border: `1px solid ${C.borderStrong}`, borderRadius: C.radius, fontSize: 13, color: C.text, background: "var(--field)", boxSizing: "border-box", minHeight: 36 };
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" className="ui-toggle" aria-checked={checked} aria-label={label ?? "Toggle setting"} disabled={disabled} onClick={() => onChange(!checked)} />;
}
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <span className="app-infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}><button type="button" className="ui-iconbtn ui-iconbtn--sm" aria-label="More information" aria-describedby={open ? id : undefined} onClick={() => setOpen(o => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}><Info size={14} /></button>{open && <span role="tooltip" className="app-tooltip" id={id}>{text}</span>}</span>;
}
export function Spinner() { return <div className="app-loading" role="status"><LoaderCircle className="app-spin" size={19} />Loading…</div>; }
export function ErrorBanner({ message }: { message: string }) {
  useEffect(()=>{if(message)window.dispatchEvent(new CustomEvent("dashboard:toast",{detail:{message:message.replace(/^Error: /,""),tone:"danger",detail:""}}));},[message]);
  return null;
}
export function DeleteIcon({label="Delete",...props}:React.ButtonHTMLAttributes<HTMLButtonElement> & {label?:string}) {
  return <button {...props} type="button" className="ui-iconbtn ui-iconbtn--danger" aria-label={label} title={label}><Trash2 size={16}/></button>;
}
export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  return <div className="ui-tabs app-tabs" role="tablist" aria-label="Sections">{tabs.map((t, i) => <button type="button" key={t.key} role="tab" aria-selected={active === t.key} tabIndex={active === t.key ? 0 : -1} className={`ui-tab ${active === t.key ? "is-active" : ""}`} onClick={() => onChange(t.key)} onKeyDown={e => {
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { e.preventDefault(); onChange(tabs[next].key); (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }
  }}>{t.label}</button>)}</div>;
}
export function JsonViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return <div style={{ marginTop: 10 }}><Btn size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? <ChevronUp /> : <ChevronDown />}{open ? "Hide" : "Show"} raw JSON</Btn>{open && <pre className="app-code">{JSON.stringify(data, null, 2)}</pre>}</div>;
}
export function MethodBadge({ method }: { method: string }) { return <span className="ui-method" data-method={method}>{method}</span>; }
export function Stat({ label, value, note }: { label: React.ReactNode; value: React.ReactNode; note?: string }) {
  return <div className="ui-stat"><div className="ui-stat__label">{label}</div><div className="ui-stat__value ui-num">{value}</div>{note && <div className="ui-stat__note">{note}</div>}</div>;
}

export function RowMenu({ items }: { items: {label:string;icon:React.ReactNode;danger?:boolean;onClick:()=>void}[] }) {
  const [open,setOpen]=useState(false); const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return; const handler=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};document.addEventListener("mousedown",handler);return()=>document.removeEventListener("mousedown",handler);},[open]);
  return <div ref={ref} className="app-rowmenu"><button className="ui-iconbtn" aria-label="Actions" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(o=>!o)}><Ellipsis /></button>{open && <div className="ui-menu" role="menu" style={{right:0,top:34}} onKeyDown={e=>{if(e.key==="Escape"){setOpen(false);ref.current?.querySelector("button")?.focus();}}}>{items.map(item=><div key={item.label}>{item.danger && <div className="ui-menu__sep" />}<button className={`ui-menu__item ${item.danger ? "ui-menu__item--danger" : ""}`} role="menuitem" onClick={()=>{setOpen(false);item.onClick();}}>{item.icon}{item.label}</button></div>)}</div>}</div>;
}

export function Code({ value, title="JSON" }: {value:unknown;title?:string}) {
  const text=typeof value==="string" ? value : JSON.stringify(value,null,2) ?? "";
  const [copied,setCopied]=useState(false);
  const parts:React.ReactNode[]=[]; const re=/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g;
  let end=0; for(const m of text.matchAll(re)){const i=m.index!;parts.push(text.slice(end,i));const cls=m[1] ? (m[2] ? "tok-key" : "tok-str") : m[3] ? "tok-lit" : m[4] ? "tok-num" : "tok-punc";parts.push(<span key={i} className={cls}>{m[1] ?? m[0]}</span>);if(m[2])parts.push(<span key={`${i}-colon`} className="tok-punc">{m[2]}</span>);end=i+m[0].length;}parts.push(text.slice(end));
  return <div className="ui-code"><div className="ui-code__bar"><span>{title}</span><button className="ui-iconbtn ui-iconbtn--sm" aria-label={copied ? "Copied" : "Copy code"} onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);}catch{setCopied(false);}}}>{copied ? <Check /> : <Copy />}</button></div><pre>{parts}</pre></div>;
}
