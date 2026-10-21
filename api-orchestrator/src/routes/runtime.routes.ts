/**
 * Runtime routes — the catch-all /api/* handler.
 * Validates end-user OIDC tokens, resolves apps and endpoints from cache,
 * builds upstream requests, transforms responses.
 * Mounted at /api in index.route.ts.
 */
export { runtimeRouter as runtimeRoutes } from "../runtime/router.js";
