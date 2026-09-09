import { Router } from "express";
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
import corsOriginsRouter from "./admin/corsOrigins.routes.js";
import aiAdminRouter from "./admin/ai.routes.js";
import { aiChatRouter, aiMcpRouter } from "./ai.routes.js";

const root = Router();

root.use("/auth", sessionResolve, authRoutes);

const configRouter = Router();
configRouter.use(sessionResolve);
configRouter.use(requireSession);

configRouter.use("/apps", appsRouter);
configRouter.use("/apps/:appId/endpoints", endpointsRouter);
configRouter.use("/apps/:appId/scripts", scriptsRouter);
configRouter.use("/admin/users", usersRouter);
configRouter.use("/admin/identity-providers", providersRouter);
configRouter.use("/admin/secrets", secretsRouter);
configRouter.use("/admin/host-allowlist", hostAllowlistRouter);
configRouter.use("/admin/organization", organizationRouter);
configRouter.use("/admin/cors-origins", corsOriginsRouter);
configRouter.use("/admin/ai", aiAdminRouter);

root.use("/__config", configRouter);

// AI zone — mounted BEFORE the runtime router (which catches every path).
// Feature-flagged internally by AI_ENABLED (404 when off).
root.use("/__ai", aiChatRouter);
root.use(aiMcpRouter);

root.use("/", runtimeRoutes);

export default root;
