import type { Request, Response, NextFunction } from "express";

export type UserRole = "admin" | "sub_admin" | "viewer";

export interface DashboardUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      dashboardUser?: DashboardUser;
    }
  }
}

const PERMISSIONS: Record<string, UserRole[]> = {
  "view:any":              ["admin", "sub_admin", "viewer"],
  "test:endpoint":         ["admin", "sub_admin", "viewer"],
  "edit:endpoints":        ["admin", "sub_admin"],
  "manage:apps":           ["admin", "sub_admin"],
  "rollback":              ["admin"],
  "manage:providers":      ["admin"],
  "manage:secrets":        ["admin"],
  "manage:users":          ["admin"],
};

export function can(user: DashboardUser, permission: string): boolean {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(user.role);
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.dashboardUser) {
      res.status(401).json({ error: "Unauthorized", code: "NOT_AUTHENTICATED" });
      return;
    }
    if (!can(req.dashboardUser, permission)) {
      res.status(403).json({ error: "Forbidden", code: "INSUFFICIENT_PERMISSIONS" });
      return;
    }
    next();
  };
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (!req.dashboardUser) {
    res.status(401).json({ error: "Unauthorized", code: "NOT_AUTHENTICATED" });
    return;
  }
  next();
}
