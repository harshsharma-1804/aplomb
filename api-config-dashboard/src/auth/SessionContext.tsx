import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { DashboardUser } from "../api/types";

interface SessionState {
  user: DashboardUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const PERMISSIONS: Record<string, Array<"admin" | "sub_admin" | "viewer">> = {
  "view:any":         ["admin", "sub_admin", "viewer"],
  "test:endpoint":    ["admin", "sub_admin", "viewer"],
  "edit:endpoints":   ["admin", "sub_admin"],
  "manage:apps":      ["admin", "sub_admin"],
  "rollback":         ["admin"],
  "export:app":       ["admin"],
  "manage:providers": ["admin"],
  "manage:secrets":   ["admin"],
  "manage:users":     ["admin"],
};

const SessionContext = createContext<SessionState>({
  user: null, loading: true,
  login: async () => {}, logout: async () => {}, can: () => false,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as DashboardUser;
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
    const handler = () => { setUser(null); setLoading(false); };
    window.addEventListener("dashboard:unauthenticated", handler);
    return () => window.removeEventListener("dashboard:unauthenticated", handler);
  }, [checkSession]);

  const login = async (username: string, password: string) => {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Login failed" })) as { error?: string };
      throw new Error(err.error ?? "Login failed");
    }
    const data = await res.json() as DashboardUser;
    setUser(data);
  };

  const logout = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  };

  const can = (permission: string): boolean => {
    if (!user) return false;
    const allowed = PERMISSIONS[permission] ?? [];
    return allowed.includes(user.role);
  };

  return (
    <SessionContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
