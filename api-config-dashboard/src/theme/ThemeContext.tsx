import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
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
  return "system";
}

const ThemeContext = createContext<{
  choice: ThemeChoice;
  theme: ResolvedTheme;
  setChoice: (c: ThemeChoice) => void;
}>({ choice: "system", theme: "light", setChoice: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
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

  return <ThemeContext.Provider value={{ choice, theme, setChoice }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
