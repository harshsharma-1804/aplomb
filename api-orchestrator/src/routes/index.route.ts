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

root.use("/__config", configRouter);
root.use("/", runtimeRoutes);

export default root;
