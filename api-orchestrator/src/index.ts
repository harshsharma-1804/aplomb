import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import compression from "compression";
import { join } from "path";
import { config } from "./config/appConfig.js";
import { initDb, closeDb, getDb } from "./db/client.js";
import { initAppCache, stopAppCachePolling, getAppByPath } from "./cache/appCache.js";
import { initProviderCache, stopProviderCachePolling } from "./cache/providerCache.js";
import { initAllowlistCache, stopAllowlistCachePolling } from "./cache/allowlistCache.js";
import { initCorsCache, isRuntimeOriginAllowed, stopCorsCachePolling } from "./cache/corsCache.js";
import { initToolRegistry } from "./ai/toolRegistry.js";
import { warmJwksCache } from "./auth/oidcValidate.js";
import { initLogger } from "./runtime/logger.js";
import { bootstrapOrganization, bootstrapAdmin, bootstrapBuiltinAiProvider } from "./db/bootstrap.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { appSessionRepo } from "./db/repos/appSessionRepo.js";
import { purgeLoginChallenges } from "./auth/appTwoFactor.js";
import rootRouter from "./routes/index.route.js";
import { closeAllPools } from "./runtime/dbUpstream.js";

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

const openCors = cors({ origin: "*" });

// Dashboard zone — dynamic so we can read req.headers.host.
// In unified mode (DASHBOARD_DIST set) the dashboard is served by this same
// process — same-origin requests always carry an Origin header on POST with
// credentials, and it must be accepted regardless of which host:port the
// operator deployed on. Same-origin = Origin host matches request Host.
function dashboardCors(req: Request, res: Response, next: NextFunction) {
  const zone = cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.cors.allowedOrigins.includes(origin)) return cb(null, true);
      if (config.dashboard.distPath) {
        try {
          if (new URL(origin).host === req.headers.host) return cb(null, true);
        } catch { /* malformed origin — fall through to reject */ }
      }
      cb(new Error(`CORS: "${origin}" not allowed on config API`));
    },
    credentials: true,
    methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization","Cookie"],
  });
  zone(req, res, next);
}

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

app.use("/__health",  openCors);
app.use("/__config",  dashboardCors);
app.use("/auth",      dashboardCors);

function runtimeCorsGuard(req: Request, res: Response, next: NextFunction) {
  const p = req.path;
  if (p.startsWith("/__config") || p.startsWith("/auth") || p.startsWith("/__health")) {
    return next();
  }

  const origin = req.headers["origin"] as string | undefined;

  // Same-origin check (unified mode): Origin host == request Host — always allow.
  if (origin && config.dashboard.distPath) {
    try {
      if (new URL(origin).host === req.headers["host"]) return next();
    } catch { /* malformed origin — fall through */ }
  }

  // Cross-origin request (Origin header present and differs from host):
  // Enforce the Allowed Origins list on ALL runtime paths — including app auth
  // routes (/login, /__2fa, /auth/login/*, /signup, etc.). Browser navigations
  // (OAuth redirects) do NOT send an Origin header, so they are unaffected.
  // This ensures that removing an origin from the Allowed Origins list also
  // blocks cross-origin credential POSTs from that origin.
  if (origin && !isRuntimeOriginAllowed(origin)) {
    res.status(403).json({
      error: "Cross-origin requests from this origin are not allowed.",
      code: "ORIGIN_NOT_ALLOWED",
    });
    return;
  }

  return runtimeCors(req, res, next);
}

app.options("/*path", runtimeCorsGuard);
app.use(runtimeCorsGuard);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.get("/__health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), service: "api-orchestrator", version: "1.0.0" });
});

// ── Dashboard static serving (unified single-container mode) ──────────────────
// Enabled only when DASHBOARD_DIST points at the built dashboard SPA.
// Empty env (default) = split deployment — static serving disabled.
//
// MUST be registered before rootRouter: the runtime router is mounted at "/"
// and catches every path (404ing unknown ones as APP_NOT_FOUND) — a fallback
// placed after it would never run.
//
// Guards, in order:
//   1. API prefixes (/__config, /auth, /__health, /api) → next() — JSON 404s stay JSON
//   2. Runtime app requests (getAppByPath matches a base_path) → next() —
//      the runtime router owns these; serving index.html here would break API calls
//   3. Everything else → SPA index.html (dashboard client-side routes)
if (config.dashboard.distPath) {
  const distPath = config.dashboard.distPath;

  app.use(compression());
  app.use(express.static(distPath, { index: false, maxAge: "1h" }));

  const serveSpa = (req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p.startsWith("/__config") || p.startsWith("/auth") || p.startsWith("/__health") || p.startsWith("/api")) {
      return next();
    }
    if (getAppByPath(p)) return next();
    res.sendFile(join(distPath, "index.html"));
  };

  // Express 5: "/*path" does not match "/" — register root explicitly
  app.get("/", serveSpa);
  app.get("/*path", serveSpa);
}

app.use(rootRouter);

// Unhandled API paths (e.g. unknown /__config or /api routes) → JSON 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use(errorHandler);

async function start(): Promise<void> {
  await initDb();
  await bootstrapOrganization();
  await bootstrapAdmin();
  bootstrapBuiltinAiProvider();
  initAppCache();
  initProviderCache();
  initAllowlistCache();
  initCorsCache();
  initToolRegistry();   // AI/MCP tool catalog from AI-exposed apps (no-op when AI_ENABLED=false)
  warmJwksCache();
  initLogger();

  // Expired app-session purge (both clocks) + 7-day-old revoked rows + stale 2FA
  // login challenges — hourly
  const sessionPurge = setInterval(() => {
    try {
      const n = appSessionRepo.purgeExpired(getDb());
      const c = purgeLoginChallenges();
      if (n || c) console.log(`[sessions] Purged ${n} expired app sessions, ${c} login challenges`);
    } catch {}
  }, 3600_000);
  sessionPurge.unref();

  const server = app.listen(config.server.port, "0.0.0.0", () => {
    console.log(`[server] api-orchestrator running on http://0.0.0.0:${config.server.port}`);
    console.log(`[server] Dashboard CORS: ${config.cors.allowedOrigins.join(", ")}`);
    console.log(`[server] Runtime CORS:   ${config.cors.runtimeOrigins.length ? config.cors.runtimeOrigins.join(", ") : "open"}`);
  });

  async function shutdown(signal: string) {
    console.log(`[server] ${signal} received — shutting down`);
    stopAppCachePolling();
    stopProviderCachePolling();
    stopAllowlistCachePolling();
    stopCorsCachePolling();
    clearInterval(sessionPurge);
    server.close(async () => { await closeAllPools(); closeDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start().catch(err => { console.error("[server] Fatal:", err); process.exit(1); });
