import type { Request, Response, NextFunction } from "express";
import { resolveSession } from "../auth/dashboardAuth.js";

export function sessionResolve(req: Request, _res: Response, next: NextFunction): void {
  try {
    const user = resolveSession(req);
    if (user) req.dashboardUser = user;
  } catch {}
  next();
}
