import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "../auth/SessionContext";
import { useTheme, type ThemeChoice } from "../theme/ThemeContext";
import { BreadcrumbContext, type Crumb } from "./BreadcrumbContext";
import { C } from "./index";

function defaultTrail(pathname: string): Crumb[] {
  if (pathname.startsWith("/apps/")) {
    const appId = pathname.split("/")[2];
    return [{ label: "App Registry", to: "/apps" }, { label: decodeURIComponent(appId ?? "") }];
  }
  if (pathname.startsWith("/bots/")) {
    const botId = pathname.split("/")[2];
    return [{ label: "Bot Registry", to: "/bots" }, { label: decodeURIComponent(botId ?? "") }];
  }
  if (pathname.startsWith("/apps")) return [{ label: "App Registry" }];
  if (pathname.startsWith("/bots")) return [{ label: "Bot Registry" }];
  if (pathname.startsWith("/settings")) return [{ label: "Tenant Settings" }];
  return [{ label: "App Registry" }];
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "🌙" },
  { value: "system", label: "System", icon: "◐" },
];

function ThemeMenu() {
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose theme"
        title="Theme"
        style={{
          width: 34, height: 34, borderRadius: C.radius, cursor: "pointer", fontSize: 14,
          background: open ? C.selection : "transparent", border: `1px solid ${open ? C.border : "transparent"}`,
          color: C.text, display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        ◐
      </button>
      {open && (
        <div role="menu" aria-label="Interface theme" style={{
          position: "absolute", top: 42, right: 0, width: 190, padding: 8, zIndex: 1001,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radiusPanel,
          boxShadow: C.shadowModal,
        }}>
          <div style={{ fontSize: 10, color: C.muted, padding: "4px 8px 8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px" }}>
            Interface theme
          </div>
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              role="menuitemradio"
              aria-checked={choice === opt.value}
              onClick={() => { setChoice(opt.value); close(); }}
              style={{
                width: "100%", border: 0, background: choice === opt.value ? C.selection : "transparent",
                borderRadius: C.radiusSm, padding: "7px 8px", display: "flex", alignItems: "center",
                gap: 10, color: C.text, fontSize: 13, cursor: "pointer", textAlign: "left",
              }}
            >
              <span aria-hidden="true">{opt.icon}</span>
              <span style={{ flex: 1, fontWeight: choice === opt.value ? 600 : 400 }}>{opt.label}</span>
              {choice === opt.value && <span style={{ color: C.primary, fontSize: 12 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const initials = (user?.username ?? "?").slice(0, 2).toUpperCase();
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title={user?.username}
        style={{
          width: 34, height: 34, borderRadius: C.radius, cursor: "pointer", fontSize: 11, fontWeight: 800,
          background: open ? C.selection : C.selection, border: `1px solid ${C.border}`,
          color: C.primary, display: "inline-flex", alignItems: "center", justifyContent: "center",
          letterSpacing: ".5px",
        }}
      >
        {initials}
      </button>
      {open && (
        <div role="menu" aria-label="Account" style={{
          position: "absolute", top: 42, right: 0, width: 200, padding: 8, zIndex: 1001,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: C.radiusPanel,
          boxShadow: C.shadowModal,
        }}>
          <div style={{ padding: "4px 8px 10px", borderBottom: `1px solid ${C.border}`, marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{user?.username}</div>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "capitalize" }}>{user?.role}</div>
          </div>
          <button
            role="menuitem"
            onClick={() => { close(); logout(); }}
            style={{
              width: "100%", border: 0, background: "transparent", borderRadius: C.radiusSm,
              padding: "7px 8px", display: "flex", alignItems: "center", gap: 8,
              color: C.danger, fontSize: 13, cursor: "pointer", textAlign: "left",
            }}
          >
            <span aria-hidden="true">⎋</span> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const location = useLocation();
  const breadcrumb = React.useContext(BreadcrumbContext);
  const trail = breadcrumb.get(location.pathname) ?? defaultTrail(location.pathname);
  return (
    <header style={{
      height: 60, flexShrink: 0, padding: "0 24px", display: "flex", alignItems: "center", gap: 14,
      borderBottom: `1px solid ${C.border}`, background: C.canvas,
    }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, minWidth: 0 }}>
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <React.Fragment key={`${crumb.label}-${i}`}>
              {i > 0 && <span aria-hidden="true">›</span>}
              {crumb.to && !last ? (
                <Link to={crumb.to} style={{ color: C.muted, textDecoration: "none", whiteSpace: "nowrap" }}
                  onMouseEnter={e => (e.currentTarget.style.color = C.primary)}
                  onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>
                  {crumb.label}
                </Link>
              ) : (
                <strong style={{
                  color: C.text, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {crumb.label}
                </strong>
              )}
            </React.Fragment>
          );
        })}
      </nav>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <ThemeMenu />
        <ProfileMenu />
      </div>
    </header>
  );
}
