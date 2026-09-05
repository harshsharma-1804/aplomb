import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config/appConfig.js";
import { connectDB } from "./db/client.js";
import { initAppCache } from "./cache/appCache.js";
import { initProviderCache } from "./cache/providerCache.js";
import { initLogger } from "./runtime/logger.js";
import { initAllowlistCache } from "./cache/allowlistCache.js";
import { initCorsCache, isRuntimeOriginAllowed } from "./cache/corsCache.js";
import { initEndpointCache } from "./cache/endpointCache.js";
import { warmJwksCache } from "./auth/oidcValidate.js";
import { bootstrapOrganization, bootstrapAdmin } from "./db/bootstrap.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import rootRouter from "./routes/index.route.js";

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
// crossOriginResourcePolicy must be "cross-origin" for runtime API endpoints
// so browsers can fetch responses from different origins.
// crossOriginOpenerPolicy is set to same-origin-allow-popups to avoid breaking
// OIDC popup flows while still providing isolation.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

// ── CORS ───────────────────────────────────────────────────────────────────────
//
// Three zones — applied by path prefix so they never overlap:
//
//  1. /__health           → open (*), no credentials
//  2. /__config + /auth   → strict, dashboard origin only
//  3. Everything else     → operator-configured runtime origins
//
// CRITICAL: OPTIONS preflight for zone 3 must NOT require OIDC auth.
// The browser sends OPTIONS before the real Bearer-token request.
// We handle OPTIONS first (before body parsing / auth middleware).

// Zone 1 — health: fully open
const openCors = cors({ origin: "*" });

// Zone 2 — dashboard config + auth: only the nginx proxy origin
const dashboardCors = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                          // server-to-server
    if (config.cors.allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: "${origin}" not allowed on config API`));
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Cookie"],
});

// Zone 3 — runtime: operator-configured origin list
const runtimeCors = cors({
  origin: (origin, cb) => {
    if (isRuntimeOriginAllowed(origin)) return cb(null, true);
    cb(new Error(`CORS: "${origin}" not in runtime allowed origins`));
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Idempotency-Key","X-Request-ID"],
  exposedHeaders: ["X-Orchestrator-App","X-Orchestrator-Version","X-Orchestrator-Mode"],
  maxAge: 86400,
});

// Apply CORS by prefix — each zone is mutually exclusive via path guard
app.use("/__health",  openCors);
app.use("/__config",  dashboardCors);
app.use("/auth",      dashboardCors);

// Runtime CORS — only for paths that are NOT config or auth routes.
// OPTIONS preflight must be answered without auth so OIDC-protected
// endpoints work: browser sends OPTIONS first, then the real Bearer request.
function runtimeCorsGuard(req: Request, res: Response, next: NextFunction) {
  const p = req.path;
  if (p.startsWith("/__config") || p.startsWith("/auth") || p.startsWith("/__health")) {
    return next(); // already handled by the appropriate zone above
  }
  return runtimeCors(req, res, next);
}

app.options("/*path", runtimeCorsGuard);
app.use(runtimeCorsGuard);

// ── Body parsing + cookies ────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/__health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), service: "api-orchestrator", version: "1.0.0" });
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use(rootRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use(errorHandler);

// ── Startup ────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await connectDB();
  const orgId = await bootstrapOrganization();
  await bootstrapAdmin(orgId);
  await initAppCache();
  await initProviderCache();
  await initAllowlistCache();
  await initCorsCache();
  await initEndpointCache();
  await warmJwksCache();   // pre-warm JWKS so first real user request pays 0ms cold-start
  initLogger();

  app.listen(config.server.port, "0.0.0.0", () => {
    console.log(`[server] api-orchestrator running on http://0.0.0.0:${config.server.port}`);
    console.log(`[server] Dashboard CORS: ${config.cors.allowedOrigins.join(", ")}`);
    console.log(`[server] Runtime CORS:   ${config.cors.runtimeOrigins.length ? config.cors.runtimeOrigins.join(", ") : "open"}`);
  });
}

start().catch(err => { console.error("[server] Fatal:", err); process.exit(1); });
