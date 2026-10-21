import React, { createContext, useContext, useEffect, useState } from "react";
import type { OrgAppearance } from "../api/types";
import { api } from "../api/client";

export type ThemeChoice = "light" | "dark" | "system";
export type ColorPalette = "current" | "coastal" | "monochrome" | "orchid";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "orchestrator-theme";
const PALETTE_KEY = "orchestrator-palette";
const OVERRIDE_KEY = "orchestrator-appearance-override";
const mq = window.matchMedia?.("(prefers-color-scheme: dark)");

/**
 * Per-browser flag: the user has explicitly picked a theme/palette here
 * (top-bar toggle or appearance selects). Org defaults no longer override
 * this browser — personal choice wins, org default applies to fresh browsers.
 */
function markOverride() {
  try { localStorage.setItem(OVERRIDE_KEY, "1"); } catch {}
}
function hasOverride(): boolean {
  try { return localStorage.getItem(OVERRIDE_KEY) === "1"; } catch { return false; }
}

function systemTheme(): ResolvedTheme {
  return mq?.matches ? "dark" : "light";
}

function initialChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // private mode etc.
  }
  return "dark";
}

const ThemeContext = createContext<{
  palette: ColorPalette;
  setPalette: (palette: ColorPalette) => void;
  choice: ThemeChoice;
  theme: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
  /** Apply org-level appearance (from server) — overrides local storage so appearance persists across browsers */
  syncFromOrg: (appearance: OrgAppearance | undefined | null) => void;
}>({ palette:"current",setPalette:()=>{},choice: "system", theme: "light", setChoice: () => {}, syncFromOrg: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [palette,setPaletteState]=useState<ColorPalette>(()=>{try {const p=localStorage.getItem(PALETTE_KEY);return p==="coastal" || p==="monochrome" || p==="orchid" ? p : "current";}catch{return "current";}});
  useEffect(()=>{document.documentElement.setAttribute("data-palette",palette);try{localStorage.setItem(PALETTE_KEY,palette);}catch{}},[palette]);
  const [choice, setChoiceState] = useState<ThemeChoice>(initialChoice);
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    choice === "system" ? systemTheme() : choice as ResolvedTheme,
  );

  // Org appearance applies even pre-auth (login page): fetch the public
  // endpoint once on mount. syncFromOrg skips browsers with a personal pick.
  useEffect(() => {
    let cancelled = false;
    fetch("/__config/public/appearance")
      .then(r => (r.ok ? r.json() : null))
      .then((a: OrgAppearance | null) => { if (!cancelled && a) syncFromOrg(a); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // User-facing setters — an explicit pick is ORG-WIDE for permitted users
  // (admins): it persists to the organization so every browser — including
  // fresh ones on the login page — lands on the same theme. Non-admins get a
  // personal per-browser choice (the PUT fails 403 and is ignored).
  const setPalette = (p: ColorPalette) => {
    markOverride();
    setPaletteState(p);
    api.put("/__config/admin/organization", { appearance: { palette: p } }).catch(() => {});
  };
  const setChoice  = (c: ThemeChoice)   => {
    markOverride();
    setChoiceState(c);
    api.put("/__config/admin/organization", { appearance: { theme: c } }).catch(() => {});
  };

  useEffect(() => {
    const apply = () => {
      const resolved = choice === "system" ? systemTheme() : choice;
      setTheme(resolved);
      document.documentElement.setAttribute("data-theme", resolved);
    };
    apply();
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // ignore
    }
    if (choice === "system" && mq) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [choice]);

  /**
   * Apply org-level appearance (server) — the default for fresh browser contexts.
   * Skipped when the user has personally picked a theme/palette in this browser
   * (override flag) — personal choice wins, org default seeds new browsers.
   */
  function syncFromOrg(appearance: OrgAppearance | undefined | null) {
    if (!appearance || hasOverride()) return;
    const { theme: orgTheme, palette: orgPalette } = appearance;
    if (orgTheme === "light" || orgTheme === "dark" || orgTheme === "system") {
      setChoiceState(prev => (prev === orgTheme ? prev : orgTheme));
      try { localStorage.setItem(STORAGE_KEY, orgTheme); } catch {}
    }
    if (orgPalette === "current" || orgPalette === "coastal" || orgPalette === "monochrome" || orgPalette === "orchid") {
      setPaletteState(prev => (prev === orgPalette ? prev : orgPalette));
      try { localStorage.setItem(PALETTE_KEY, orgPalette); } catch {}
    }
  }

  return <ThemeContext.Provider value={{ choice, theme, setChoice, palette, setPalette, syncFromOrg }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
