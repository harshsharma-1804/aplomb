import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ColorPalette = "current" | "coastal" | "monochrome" | "orchid";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "orchestrator-theme";
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
}>({ palette:"current",setPalette:()=>{},choice: "system", theme: "light", setChoice: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [palette,setPalette]=useState<ColorPalette>(()=>{try {const p=localStorage.getItem("orchestrator-palette");return p==="coastal" || p==="monochrome" || p==="orchid" ? p : "current";}catch{return "current";}});
  useEffect(()=>{document.documentElement.setAttribute("data-palette",palette);try{localStorage.setItem("orchestrator-palette",palette);}catch{}},[palette]);
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

  return <ThemeContext.Provider value={{ choice, theme, setChoice, palette, setPalette }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
