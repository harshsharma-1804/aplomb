import { Router, type Request, type Response, type NextFunction } from "express";
import { sessionResolve } from "../middlewares/sessionResolve.js";
import { requireSession } from "../auth/rbac.js";
import { authRoutes } from "./auth.routes.js";
import { runtimeRoutes } from "./runtime.routes.js";
import appsRouter from "./apps/apps.routes.js";
import endpointsRouter from "./apps/endpoints.routes.js";
import scriptsRouter from "./apps/scripts.routes.js";
import usersRouter from "./admin/users.routes.js";
import providersRouter from "./admin/providers.routes.js";
import secretsRouter from "./admin/secrets.routes.js";
import hostAllowlistRouter from "./admin/hostAllowlist.routes.js";
import organizationRouter from "./admin/organization.routes.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";

const root = Router();

// ── Auth ─────────────────────────────────────────────────────────────────────
root.use("/auth", sessionResolve, authRoutes);

// ── Config API ────────────────────────────────────────────────────────────────
const configRouter = Router();
configRouter.use(sessionResolve);
configRouter.use(requireSession);

/**
 * Org context middleware — resolves the organization for the authenticated
 * dashboard user and attaches req.orgId. All config routes below this point
 * are automatically scoped to the user's organization.
 */
configRouter.use(async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).dashboardUser?.id;
    if (userId) {
      const user = await User.findById(userId).lean();
      if (user?.org_id) {
        (req as any).orgId = String(user.org_id);
      } else {
        // Fall back to the first (and usually only) org
        const org = await Organization.findOne().lean();
        if (org) (req as any).orgId = String(org._id);
      }
    }
  } catch {
    // Non-fatal — routes that need orgId will handle it
  }
  next();
});

// Apps + Endpoints + Scripts
configRouter.use("/apps", appsRouter);
configRouter.use("/apps/:appId/endpoints", endpointsRouter);
configRouter.use("/apps/:appId/scripts", scriptsRouter);

// Admin scoped routes
configRouter.use("/admin/users", usersRouter);
configRouter.use("/admin/identity-providers", providersRouter);
configRouter.use("/admin/secrets", secretsRouter);
configRouter.use("/admin/host-allowlist", hostAllowlistRouter);
configRouter.use("/admin/organization", organizationRouter);

root.use("/__config", configRouter);

// ── Runtime — mounted last ────────────────────────────────────────────────────
root.use("/", runtimeRoutes);

export default root;
