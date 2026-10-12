import { useGuardedAction } from "./PageSave";
import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bot, Boxes, Check, ChevronRight, LogOut, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { useSession } from "../auth/SessionContext";
import { useTheme, type ThemeChoice } from "../theme/ThemeContext";
import { BreadcrumbContext, type Crumb } from "./BreadcrumbContext";
import { Modal, Spinner, ErrorBanner } from "./index";
import { api } from "../api/client";
import type { App, AiBot, ListResult } from "../api/types";
function defaultTrail(path: string): Crumb[] { return [{ label: path.startsWith('/bots') ? 'Bot Registry' : path.startsWith('/settings') ? 'Tenant Settings' : 'App Registry' }]; }
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); }; const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; document.addEventListener('mousedown', down); document.addEventListener('keydown', key); return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); }; }, [open, close]);
  return ref;
}
const choices: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }];
function ThemeMenu() {
  const { theme,setChoice }=useTheme();
  return <button type="button" className="ui-iconbtn ui-iconbtn--bordered" aria-label="Switch theme" onClick={()=>setChoice(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Moon /> : <Sun />}</button>;
}
function ProfileMenu() {
  const guard=useGuardedAction(); const { user, logout } = useSession(); const [open, setOpen] = useState(false); const ref = useDismiss(open, () => setOpen(false));
  return <div ref={ref} className="app-menu-anchor"><button className="ui-avatar" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>{(user?.username ?? 'U').slice(0,2).toUpperCase()}</button>{open && <div className="app-menu" role="menu"><div className="app-menu-title">{user?.username}<div className="ui-muted">{user?.role.replace(/_/g,' ')}</div></div><button className="app-menu-item" role="menuitem" onClick={() => { setOpen(false); guard(()=>{void logout();}); }}><LogOut size={16} />Sign out</button></div>}</div>;
}
type SearchItem = { label: string; path: string; kind: 'page' | 'app' | 'bot'; detail?: string };
function CommandSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate(); const { can } = useSession(); const [query, setQuery] = useState(''); const [items, setItems] = useState<SearchItem[]>([{ label:'App Registry', path:'/apps', kind:'page' },{ label:'Bot Registry', path:'/bots', kind:'page' },{ label:'Tenant Settings', path:'/settings', kind:'page' }]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  useEffect(() => { let active = true; (async () => { try { const apps = await api.get<ListResult<App>>('/__config/apps'); const bots = can('manage:providers') ? await api.get<ListResult<AiBot>>('/__config/admin/ai/bots') : { results: [] }; if (active) setItems(prev => [...prev, ...apps.results.map(a => ({ label:a.name, path:`/apps/${a._id}`, detail:a.base_path, kind:'app' as const })), ...bots.results.map(b => ({ label:b.name, path:`/bots/${b._id}`, kind:'bot' as const }))]); } catch (e) { if (active) setError(String(e)); } finally { if (active) setLoading(false); } })(); return () => { active = false; }; }, []);
  const filtered = items.filter(i => `${i.label} ${i.detail ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const select = (item: SearchItem) => { navigate(item.path); onClose(); };
  return <Modal title="Search or jump to…" onClose={onClose} width={620}><div className="ui-search"><Search /><input className="ui-input" autoFocus aria-label="Search apps, bots and settings" placeholder="Search apps, bots and settings…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && filtered[0]) select(filtered[0]); }} /></div>{error && <ErrorBanner message={error} />}{loading && <Spinner />}<div className="app-search-results">{filtered.slice(0,25).map(item => <button type="button" key={item.path} className="app-search-result" onClick={() => select(item)}>{item.kind === 'bot' ? <Bot size={16} /> : item.path.startsWith('/settings') ? <Settings size={16} /> : <Boxes size={16} />}<div className="ui-grow"><div>{item.label}</div>{item.detail && <div className="ui-hint">{item.detail}</div>}</div><ChevronRight size={15} /></button>)}{!loading && !filtered.length && <div className="app-empty">No results match your search</div>}</div></Modal>;
}
export function TopBar() {
  const { pathname } = useLocation(); const breadcrumb = React.useContext(BreadcrumbContext); const trail = breadcrumb.get(pathname) ?? defaultTrail(pathname); const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(o => !o); } }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, []);
  return <header className="ui-topbar"><nav className="ui-crumbs" aria-label="Breadcrumb">{trail.map((c,i) => <span className="ui-row" key={`${c.label}-${i}`}>{i > 0 && <ChevronRight />}{c.to ? <Link to={c.to}>{c.label}</Link> : <strong>{c.label}</strong>}</span>)}</nav><div className="ui-grow" /><button type="button" className="ui-kbar-trigger" aria-label="Search or jump to" onClick={() => setSearchOpen(true)}><Search /><span className="ui-grow">Search or jump to…</span><kbd className="ui-kbd">⌘K</kbd></button><ThemeMenu /><ProfileMenu />{searchOpen && <CommandSearch onClose={() => setSearchOpen(false)} />}</header>;
}
