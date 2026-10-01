import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useSession } from "./auth/SessionContext";
import { LoginPage } from "./pages/Login/LoginPage";
import { AppsPage } from "./pages/Apps/AppsPage";
import { AppDetailPage } from "./pages/AppDetail/AppDetailPage";
import { BotsPage } from "./pages/Bots/BotsPage";
import { BotDetailPage } from "./pages/BotDetail/BotDetailPage";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { TopBar } from "./components/TopBar";
import { C } from "./components";

const NAV_SECTIONS = [
  {
    title: "Workspace",
    items: [
      { label: "Overview", icon: "⌂", hint: "Coming soon", to: null },
      { label: "App Registry", icon: "▦", hint: undefined, to: "/apps" },
      { label: "Bot Registry", icon: "✦", hint: undefined, to: "/bots" },
    ],
  },
  {
    title: "Manage",
    items: [
      { label: "Tenant Settings", icon: "⚙", hint: undefined, to: "/settings" },
      { label: "Activity", icon: "◔", hint: "Coming soon", to: null },
    ],
  },
];

function navItemStyle(active: boolean) {
  return {
    display: "flex", alignItems: "center", gap: 8, textDecoration: "none",
    fontSize: 13, fontWeight: active ? 600 : 500, padding: "8px 10px",
    borderRadius: C.radius, transition: "background .15s, color .15s",
    background: active ? C.sidebarHover : "transparent",
    color: active ? C.sidebarText : C.sidebarTextMuted,
  };
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px",
  color: C.sidebarTextMuted, padding: "0 10px", opacity: 0.7,
};

const SIDEBAR_KEY = "orchestrator-sidebar-collapsed";

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user } = useSession();
  return (
    <aside style={{
      width: collapsed ? 64 : 248, flexShrink: 0, background: C.sidebar, color: C.sidebarText,
      padding: "24px 12px 18px", display: "flex", flexDirection: "column", gap: 20,
      overflowY: "auto", overflowX: "hidden", transition: "width .18s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: collapsed ? 0 : 8, padding: "0 8px", justifyContent: collapsed ? "center" : "flex-start" }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-.2px", whiteSpace: "nowrap", overflow: "hidden", opacity: collapsed ? 0 : 1, maxWidth: collapsed ? 0 : 200, transition: "max-width .18s ease, opacity .12s ease" }}>Workspace</span>
      </div>

      {NAV_SECTIONS.map(section => (
        <div key={section.title} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {collapsed
            ? <div aria-hidden="true" style={{ height: 1, background: C.sidebarHover, margin: "0 8px 6px" }} />
            : <div style={sectionTitleStyle}>{section.title}</div>}
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: collapsed ? 0 : 4 }} aria-label={`${section.title} navigation`}>
            {section.items.map(item => {
              const fade: React.CSSProperties = {
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                opacity: collapsed ? 0 : 1,
                maxWidth: collapsed ? 0 : 200,
                transition: "max-width .18s ease, opacity .12s ease",
              };
              const icon = (
                <span aria-hidden="true" style={{ fontSize: 15, width: 20, textAlign: "center", flexShrink: 0 }}>{item.icon}</span>
              );
              const label = <span style={fade}>{item.label}</span>;
              if (item.to) {
                return (
                  <NavLink key={item.label} to={item.to} title={item.label}
                    style={({ isActive }) => ({
                      ...navItemStyle(isActive),
                      justifyContent: collapsed ? "center" : "flex-start",
                      gap: collapsed ? 0 : 8,
                      padding: collapsed ? "8px 0" : "8px 10px",
                    })}>
                    {icon}
                    {label}
                  </NavLink>
                );
              }
              return (
                <span key={item.label} title={`${item.label} — ${item.hint}`} aria-disabled="true" style={{
                  ...navItemStyle(false), cursor: "default", opacity: 0.55,
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: collapsed ? 0 : 8,
                  padding: collapsed ? "8px 0" : "8px 10px",
                }}>
                  {icon}
                  {label}
                  {!collapsed && (
                    <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px", border: `1px solid ${C.sidebarHover}`, borderRadius: 99, padding: "1px 6px", color: C.sidebarTextMuted }}>
                      Soon
                    </span>
                  )}
                </span>
              );
            })}
          </nav>
        </div>
      ))}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 2, opacity: collapsed || !user ? 0 : 1, maxWidth: collapsed ? 0 : 200, overflow: "hidden", margin: collapsed ? "0" : "0 0 0", transition: "max-width .18s ease, opacity .12s ease" }}>
          <span style={{ fontSize: 12, color: C.sidebarText, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.username ?? ""}</span>
          <span style={{ fontSize: 11, color: C.sidebarTextMuted, textTransform: "capitalize" }}>{user?.role ?? ""}</span>
        </div>
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: collapsed ? 0 : 8,
            background: "transparent", border: `1px solid ${C.sidebarHover}`, borderRadius: C.radius,
            cursor: "pointer", fontSize: 13, color: C.sidebarTextMuted, padding: "6px 0", width: "100%",
          }}
        >
          {collapsed ? "»" : "«"}
          <span style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", opacity: collapsed ? 0 : 1, maxWidth: collapsed ? 0 : 100, transition: "max-width .18s ease, opacity .12s ease" }}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}

function Shell() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "collapsed"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded"); } catch { /* ignore */ }
  }, [collapsed]);
  return (
    <div style={{
      height: "100vh", display: "flex", background: C.canvas, overflow: "hidden",
    }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <main style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <TopBar />
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "24px 24px 20px", display: "flex", flexDirection: "column" }}>
          <div style={{ width: "100%", maxWidth: 1200, margin: "0 auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Routes>
              <Route path="/" element={<Navigate to="/apps" replace />} />
              <Route path="/apps" element={<AppsPage />} />
              <Route path="/apps/:appId/*" element={<AppDetailPage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="/bots/:botId" element={<BotDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/:tab" element={<SettingsPage />} />
            </Routes>
          </div>
        </div>
      </main>
    </div>
  );
}

export function App() {
  const { user, loading } = useSession();
  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.canvas, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.muted, fontSize: 14 }}>Loading…</div>
    </div>
  );
  if (!user) return <LoginPage />;
  return <Shell />;
}
