/**
 * Auth routes — dashboard local credential login/logout/me/change-password.
 * These are the ONLY routes that do not require an existing session.
 * Mounted at /auth in index.route.ts.
 */
export { authRouter as authRoutes } from "../auth/dashboardAuth.js";
