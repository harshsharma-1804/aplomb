import React, { createContext, useContext, useEffect, useState } from "react";
import type { OrgAppearance } from "../api/types";

export type ThemeChoice = "light" | "dark" | "system";
export type ColorPalette = "current" | "coastal" | "monochrome" | "orchid";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "orchestrator-theme";
const PALETTE_KEY = "orchestrator-palette";
const mq = window.matchMedia?.("(prefers-color-scheme: dark)");

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
  const [palette,setPalette]=useState<ColorPalette>(()=>{try {const p=localStorage.getItem(PALETTE_KEY);return p==="coastal" || p==="monochrome" || p==="orchid" ? p : "current";}catch{return "current";}});
  useEffect(()=>{document.documentElement.setAttribute("data-palette",palette);try{localStorage.setItem(PALETTE_KEY,palette);}catch{}},[palette]);
  const [choice, setChoice] = useState<ThemeChoice>(initialChoice);
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    choice === "system" ? systemTheme() : choice as ResolvedTheme,
  );

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
   * Org settings are the source of truth for logged-in users. Called after the
   * org is fetched — applies the saved theme/palette and mirrors it into
   * localStorage so the next page load hydrates instantly with the right look.
   */
  function syncFromOrg(appearance: OrgAppearance | undefined | null) {
    if (!appearance) return;
    const { theme: orgTheme, palette: orgPalette } = appearance;
    if (orgTheme === "light" || orgTheme === "dark" || orgTheme === "system") {
      setChoice(prev => (prev === orgTheme ? prev : orgTheme));
      try { localStorage.setItem(STORAGE_KEY, orgTheme); } catch {}
    }
    if (orgPalette === "current" || orgPalette === "coastal" || orgPalette === "monochrome" || orgPalette === "orchid") {
      setPalette(prev => (prev === orgPalette ? prev : orgPalette));
      try { localStorage.setItem(PALETTE_KEY, orgPalette); } catch {}
    }
  }

  return <ThemeContext.Provider value={{ choice, theme, setChoice, palette, setPalette, syncFromOrg }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
