import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config/appConfig.js";
import { initDb, closeDb } from "./db/client.js";
import { initAppCache, stopAppCachePolling } from "./cache/appCache.js";
import { initProviderCache, stopProviderCachePolling } from "./cache/providerCache.js";
import { initAllowlistCache, stopAllowlistCachePolling } from "./cache/allowlistCache.js";
import { initCorsCache, isRuntimeOriginAllowed, stopCorsCachePolling } from "./cache/corsCache.js";
import { warmJwksCache } from "./auth/oidcValidate.js";
import { initLogger } from "./runtime/logger.js";
import { bootstrapOrganization, bootstrapAdmin } from "./db/bootstrap.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import rootRouter from "./routes/index.route.js";

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));

const openCors = cors({ origin: "*" });

const dashboardCors = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (config.cors.allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: "${origin}" not allowed on config API`));
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Cookie"],
});

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
  return runtimeCors(req, res, next);
}

app.options("/*path", runtimeCorsGuard);
app.use(runtimeCorsGuard);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.get("/__health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), service: "api-orchestrator", version: "1.0.0" });
});

app.use(rootRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
});

app.use(errorHandler);

async function start(): Promise<void> {
  await initDb();
  await bootstrapOrganization();
  await bootstrapAdmin();
  initAppCache();
  initProviderCache();
  initAllowlistCache();
  initCorsCache();
  warmJwksCache();
  initLogger();

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
    server.close(() => { closeDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start().catch(err => { console.error("[server] Fatal:", err); process.exit(1); });
