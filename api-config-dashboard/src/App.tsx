import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useSession } from "./auth/SessionContext";
import { LoginPage } from "./pages/Login/LoginPage";
import { AppsPage } from "./pages/Apps/AppsPage";
import { AppDetailPage } from "./pages/AppDetail/AppDetailPage";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { C } from "./components";

const NAV = [
  { to: "/apps",     label: "App Registry" },
  { to: "/settings", label: "⚙ Tenant Settings" },
];

function Shell() {
  const { user, logout } = useSession();
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, overflow: "hidden" }}>
      <nav style={{ background: "#1a1a2e", height: 48, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 20px", gap: 0 }}>
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14, marginRight: 28, letterSpacing: "-.2px" }}>⚡ Orchestrator</span>
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} style={({ isActive }) => ({
            color: isActive ? "#fff" : "#adb5bd", textDecoration: "none", fontSize: 13, fontWeight: 500,
            padding: "14px 14px", borderBottom: `2px solid ${isActive ? "#4dabf7" : "transparent"}`, transition: "color .15s",
          })}>{n.label}</NavLink>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#868e96" }}>
            {user?.username}{" "}
            <span style={{ background: "#343a40", padding: "1px 6px", borderRadius: 3, fontSize: 10 }}>{user?.role}</span>
          </span>
          <button onClick={logout} style={{ background: "none", border: `1px solid #495057`, borderRadius: C.radius, cursor: "pointer", fontSize: 12, color: "#adb5bd", padding: "4px 10px" }}>
            Sign out
          </button>
        </div>
      </nav>
      <main style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "20px 16px", display: "flex", flexDirection: "column" }}>
        <div style={{ width: "100%", maxWidth: 1200, margin: "0 auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Routes>
            <Route path="/" element={<Navigate to="/apps" replace />} />
            <Route path="/apps" element={<AppsPage />} />
            <Route path="/apps/:appId/*" element={<AppDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:tab" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export function App() {
  const { user, loading } = useSession();
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#adb5bd", fontSize: 14 }}>Loading…</div>
    </div>
  );
  if (!user) return <LoginPage />;
  return <Shell />;
}
