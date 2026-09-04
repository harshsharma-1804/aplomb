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
import { bootstrapOrganization, bootstrapAdmin } from "./db/bootstrap.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import rootRouter from "./routes/index.route.js";

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS — health endpoint: fully open ────────────────────────────────────────
app.options("/__health", cors({ origin: "*" }));
app.get("/__health", cors({ origin: "*" }), (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "api-orchestrator",
    version: "1.0.0",
  });
});

// ── CORS — dashboard config + auth: strict, dashboard origin only ─────────────
// Applied to /__config/* and /auth/* — only the dashboard (nginx on port 5000)
// is allowed. Any other origin gets a CORS rejection.
const dashboardCors = cors({
  origin: (origin, cb) => {
    // Allow requests with no Origin (server-to-server, curl, etc.)
    if (!origin) return cb(null, true);
    if (config.cors.allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin "${origin}" is not allowed for the config API`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
});

app.use("/auth", dashboardCors);
app.use("/__config", dashboardCors);

// ── CORS — runtime API: operator-configured origin allowlist ──────────────────
// Applied to all runtime endpoint paths (anything not matched above).
//
// CRITICAL: OPTIONS preflight requests MUST be handled here WITHOUT requiring
// OIDC auth. The browser sends OPTIONS before the actual authenticated request.
// If preflight fails, the real request (with Bearer token) never gets sent.
//
// The runtime OIDC auth happens in the route handler — not at the CORS layer.
const runtimeCors = cors({
  origin: (origin, cb) => {
    if (isRuntimeOriginAllowed(origin)) return cb(null, true);
    cb(new Error(`CORS: origin "${origin}" is not in the runtime allowed origins list`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-ID"],
  exposedHeaders: ["X-Orchestrator-App", "X-Orchestrator-Version", "X-Orchestrator-Mode"],
  maxAge: 86400, // Cache preflight for 24h — reduces OPTIONS round-trips
});

// Handle OPTIONS preflight for runtime routes without any auth middleware
app.options("/*path", runtimeCors);

// Apply runtime CORS to all other routes (actual requests)
app.use(runtimeCors);

// ── Body parsing + cookies ────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use(rootRouter);

// ── 404 fallthrough ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

// ── Centralised error handler — must be last ───────────────────────────────────
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
  initLogger();

  app.listen(config.server.port, "0.0.0.0", () => {
    console.log(`[server] api-orchestrator running on http://0.0.0.0:${config.server.port}`);
    console.log(`[server] Dashboard CORS: ${config.cors.allowedOrigins.join(", ")}`);
    console.log(`[server] Runtime CORS:   ${config.cors.runtimeOrigins.length ? config.cors.runtimeOrigins.join(", ") : "open (configure via Admin → Allowed Origins)"}`);
    console.log(`[server] Health:      http://localhost:${config.server.port}/__health`);
    console.log(`[server] Config API:  http://localhost:${config.server.port}/__config`);
    console.log(`[server] Runtime:     http://localhost:${config.server.port}/api/*`);
  });
}

start().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
