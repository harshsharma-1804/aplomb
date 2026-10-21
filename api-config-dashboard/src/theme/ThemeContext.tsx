import React, { createContext, useContext, useEffect, useState } from "react";
import type { OrgAppearance } from "../api/types";

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

  // User-facing setters — every explicit pick marks this browser as overridden,
  // so org defaults stop forcing values here on subsequent loads.
  const setPalette = (p: ColorPalette) => { markOverride(); setPaletteState(p); };
  const setChoice  = (c: ThemeChoice)   => { markOverride(); setChoiceState(c); };

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
