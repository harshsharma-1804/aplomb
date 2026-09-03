import type { Request, Response, NextFunction } from "express";
import { resolveSession } from "../auth/dashboardAuth.js";

/**
 * Reads the session cookie on every /__config/* request and attaches
 * the resolved DashboardUser to req.dashboardUser.
 * Does NOT reject — that is the job of requireSession / requirePermission.
 */
export async function sessionResolve(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await resolveSession(req);
    if (user) req.dashboardUser = user;
  } catch {
    // Non-fatal — unauthenticated request continues and will be rejected
    // by requireSession if the route needs auth.
  }
  next();
}
