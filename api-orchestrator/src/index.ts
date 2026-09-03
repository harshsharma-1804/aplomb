import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config/appConfig.js";
import { connectDB } from "./db/client.js";
import { initAppCache } from "./cache/appCache.js";
import { initProviderCache } from "./cache/providerCache.js";
import { initLogger } from "./runtime/logger.js";
import { initAllowlistCache } from "./cache/allowlistCache.js";
import { bootstrapOrganization, bootstrapAdmin } from "./db/bootstrap.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import rootRouter from "./routes/index.route.js";

const app = express();

// ── Global middleware ──────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.cors.allowedOrigins, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

// ── Health ─────────────────────────────────────────────────────────────────────
app.get("/__health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "api-orchestrator",
    version: "1.0.0",
  });
});

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
  initLogger();

  app.listen(config.server.port, "0.0.0.0", () => {
    console.log(`[server] api-orchestrator running on http://0.0.0.0:${config.server.port}`);
    console.log(`[server] Health:      http://localhost:${config.server.port}/__health`);
    console.log(`[server] Config API:  http://localhost:${config.server.port}/__config`);
    console.log(`[server] Auth:        http://localhost:${config.server.port}/auth`);
    console.log(`[server] Runtime:     http://localhost:${config.server.port}/api/*`);
  });
}

start().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
