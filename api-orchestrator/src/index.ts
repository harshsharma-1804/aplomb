import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { config } from "./config/appConfig.js";
import { initDb, closeDb } from "./db/client.js";
import { initAppCache, stopAppCachePolling } from "./cache/appCache.js";
import { initProviderCache, stopProviderCachePolling } from "./cache/providerCache.js";
import { initAllowlistCache, stopAllowlistCachePolling } from "./cache/allowlistCache.js";
import { initLogger } from "./runtime/logger.js";
import { bootstrapOrganization, bootstrapAdmin } from "./db/bootstrap.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import rootRouter from "./routes/index.route.js";

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.cors.allowedOrigins, credentials: true }));
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
  initLogger();

  const server = app.listen(config.server.port, "0.0.0.0", () => {
    console.log(`[server] api-orchestrator running on http://0.0.0.0:${config.server.port}`);
    console.log(`[server] Health:      http://localhost:${config.server.port}/__health`);
    console.log(`[server] Config API:  http://localhost:${config.server.port}/__config`);
    console.log(`[server] Runtime:     http://localhost:${config.server.port}/api/*`);
  });

  async function shutdown(signal: string) {
    console.log(`[server] ${signal} received — shutting down`);
    stopAppCachePolling();
    stopProviderCachePolling();
    stopAllowlistCachePolling();
    server.close(() => { closeDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
