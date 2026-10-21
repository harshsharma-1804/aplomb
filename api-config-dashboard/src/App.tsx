import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { Activity, Bot, Boxes, ChevronsLeft, ChevronsRight, LayoutDashboard, Settings, Zap } from "lucide-react";
import { useSession } from "./auth/SessionContext";
import { LoginPage } from "./pages/Login/LoginPage";
import { AppsPage } from "./pages/Apps/AppsPage";
import { AppDetailPage } from "./pages/AppDetail/AppDetailPage";
import { BotsPage } from "./pages/Bots/BotsPage";
import { BotDetailPage } from "./pages/BotDetail/BotDetailPage";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { api } from "./api/client";
import { TopBar } from "./components/TopBar";
import { Spinner } from "./components";
import { useTheme } from "./theme/ThemeContext";
import type { Organization } from "./api/types";
const NAV = [
  { title: "Workspace", items: [{ label: "Overview", icon: LayoutDashboard, to: null }, { label: "App Registry", icon: Boxes, to: "/apps" }, { label: "Bot Registry", icon: Bot, to: "/bots" }] },
  { title: "Manage", items: [{ label: "Tenant Settings", icon: Settings, to: "/settings" }, { label: "Activity", icon: Activity, to: null }] },
];
function Shell() {
  const { user } = useSession();
  const { syncFromOrg } = useTheme();
  const [orgName,setOrgName]=useState("");
  useEffect(()=>{api.get<Organization>("/__config/admin/organization").then(o=>{setOrgName(o.name);syncFromOrg(o.appearance);}).catch(()=>{});},[]);
  const [collapsed, setCollapsed] = useState(() => {
    try { const stored = localStorage.getItem("orchestrator-sidebar-collapsed"); return stored ? stored === "collapsed" : window.innerWidth < 960; } catch { return window.innerWidth < 960; }
  });
  useEffect(() => { try { localStorage.setItem("orchestrator-sidebar-collapsed", collapsed ? "collapsed" : "expanded"); } catch {} }, [collapsed]);
  const initials = (user?.username ?? "User").slice(0, 2).toUpperCase();
  return <div className="ui-shell">
    <aside className={`ui-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="ui-brand"><span className="ui-brand__mark"><Zap /></span><div className="ui-collapse-hide"><div className="ui-brand__name">Aplomb</div><div className="ui-brand__sub">{orgName || "Workspace"}</div></div></div>
      {NAV.map(section => <div key={section.title}><div className="ui-nav-title ui-collapse-hide">{section.title}</div><nav className="ui-nav" aria-label={`${section.title} navigation`}>{section.items.map(item => item.to ? <NavLink key={item.label} to={item.to} title={item.label} aria-label={item.label} className={({ isActive }) => `ui-nav-item ${isActive ? "is-active" : ""}`}><item.icon /><span className="ui-collapse-hide">{item.label}</span></NavLink> : <span key={item.label} className="ui-nav-item is-disabled" title={`${item.label} — coming soon`}><item.icon /><span className="ui-collapse-hide">{item.label}</span><span className="ui-soon ui-collapse-hide">Soon</span></span>)}</nav></div>)}
      <div className="app-sidebar-bottom"><div className="ui-userchip ui-collapse-hide"><span className="ui-avatar">{initials}</span><div className="ui-grow"><div>{user?.username}</div><div className="ui-faint" style={{ fontSize: 11 }}>{user?.role.replace(/_/g, " ").replace(/^./, c=>c.toUpperCase())}</div></div></div><button className="ui-nav-item" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => setCollapsed(c => !c)}>{collapsed ? <ChevronsRight /> : <ChevronsLeft />}<span className="ui-collapse-hide">Collapse</span></button></div>
    </aside>
    <main className="ui-main"><TopBar /><div className="ui-content app-content"><Routes>
      <Route path="/" element={<Navigate to="/apps" replace />} />
      <Route path="/apps" element={<AppsPage />} /><Route path="/apps/:appId/*" element={<AppDetailPage />} />
      <Route path="/bots" element={<BotsPage />} /><Route path="/bots/:botId" element={<BotDetailPage />} />
      <Route path="/settings" element={<SettingsPage />} /><Route path="/settings/:tab" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/apps" replace />} />
    </Routes></div></main>
  </div>;
}
export function App() { const { user, loading } = useSession(); if (loading) return <div className="app-boot"><Spinner /></div>; return user ? <Shell /> : <LoginPage />; }
