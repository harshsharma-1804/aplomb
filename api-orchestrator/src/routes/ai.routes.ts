import { Router, type Request, type Response, type NextFunction } from "express";
import { getDb } from "../db/client.js";
import { aiBotRepo } from "../db/repos/aiBotRepo.js";
import { runChatAgent, validateBotPayload } from "../ai/chatAgent.js";
import { handleMcpRequest } from "../ai/mcpServer.js";
import { config } from "../config/appConfig.js";
import { appSessionRepo, resolveSessionConfig } from "../db/repos/appSessionRepo.js";
import { sessionCookieName } from "../auth/appSessionAuth.js";
import { getAllApps } from "../cache/appCache.js";

/**
 * AI zone — feature-flagged by AI_ENABLED (404 when off).
 *
 * POST /__ai/chat   — chatbot conversations
 * POST /mcp         — MCP JSON-RPC 2.0 endpoint for external AI clients
 *
 * Authentication (in precedence order):
 *   1. X-Bot-Key header — registered bot key (dashboard Admin → AI Bots)
 *   2. orc_sid session cookie — app-scoped session minted by POST {base_path}/login
 *      or {base_path}/session/verify. The bot is resolved from the session's
 *      bot_snapshot (bots bound to that app at login); user identity comes from
 *      the session — client-supplied user.id is IGNORED when a session is present.
 *
 * Exported as two routers because they mount at different prefixes:
 *   aiChatRouter → root.use("/__ai", aiChatRouter)
 *   aiMcpRouter  → root.use(aiMcpRouter)
 */

// ── Feature gate ──────────────────────────────────────────────────────────────

function aiGate(req: Request, res: Response, next: NextFunction) {
  if (!config.ai.enabled) {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
    return;
  }
  next();
}

// ── Bot-key middleware ────────────────────────────────────────────────────────

async function requireBotKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-bot-key"] as string | undefined;
  if (!key) {
    res.status(401).json({ error: "X-Bot-Key header is required", code: "MISSING_BOT_KEY" });
    return;
  }
  const bot = await aiBotRepo.verifyKey(getDb(), key);
  if (!bot) {
    res.status(401).json({ error: "Invalid or disabled bot key", code: "INVALID_BOT_KEY" });
    return;
  }
  (req as any).aiBot = bot;
  next();
}

// ── Session-based auth (alternative to bot key) ───────────────────────────────

export interface SessionAuthContext {
  bot: ReturnType<typeof aiBotRepo.findById> & object;
  appId: string;
  sub: string;
  sessionId: string;
}

/**
 * Resolve a bot from an app-scoped session cookie. Iterates session-auth apps,
 * finds the first valid cookie, then picks a bot from the session's bot_snapshot
 * (explicit body.bot_id disambiguates when several bots are bound).
 */
function resolveSessionAuth(req: Request, requestedBotId?: string): SessionAuthContext | { error: string; code: string } {
  const db = getDb();
  for (const app of getAllApps()) {
    if ((app as any).auth_mode !== "session" && (app as any).auth_mode !== "both") continue;
    const cookieName = sessionCookieName(app);
    const cookieValue = req.cookies?.[cookieName] as string | undefined;
    if (!cookieValue) continue;
    const cfg = resolveSessionConfig(app as any);
    const principal = appSessionRepo.findValid(db, cookieValue, app.id);
    if (!principal) continue;
    appSessionRepo.touch(db, principal.sessionId, cfg, (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? null);

    const snapshotIds = principal.botSnapshot;
    if (snapshotIds.length === 0) {
      return { error: "No bot is bound to this app", code: "NO_BOT_BOUND" };
    }
    const botId = requestedBotId && snapshotIds.includes(requestedBotId) ? requestedBotId : snapshotIds[0]!;
    const bot = aiBotRepo.findById(db, botId);
    if (!bot || !bot.is_active) {
      return { error: "The bot bound to this session is unavailable", code: "BOT_UNAVAILABLE" };
    }
    return { bot, appId: app.id, sub: principal.sub, sessionId: principal.sessionId };
  }
  return { error: "A valid session cookie or X-Bot-Key is required", code: "MISSING_BOT_KEY" };
}

// ── Per-bot rate limiting (sliding 60s window, in-memory) ─────────────────────

const rateBuckets = new Map<string, number[]>();

function checkRateLimit(botId: string, limitPerMin: number): boolean {
  const nowMs = Date.now();
  const bucket = (rateBuckets.get(botId) ?? []).filter(ts => nowMs - ts < 60_000);
  if (bucket.length >= limitPerMin) {
    rateBuckets.set(botId, bucket);
    return false;
  }
  bucket.push(nowMs);
  rateBuckets.set(botId, bucket);
  return true;
}

function applyRateLimit(req: Request, res: Response): boolean {
  const bot = (req as any).aiBot;
  const limit = bot?.limits?.rate_limit_per_min;
  if (!limit || Number(limit) <= 0) return true;
  if (!checkRateLimit(bot.id, Number(limit))) {
    res.status(429).json({ error: `Rate limit exceeded — max ${limit} requests per minute for this bot`, code: "RATE_LIMITED" });
    return false;
  }
  return true;
}

// ── Chat router (mounted at /__ai) ────────────────────────────────────────────

export const aiChatRouter = Router();
aiChatRouter.use(aiGate);

aiChatRouter.post("/chat", async (req, res) => {
  const key = req.headers["x-bot-key"] as string | undefined;

  if (key) {
    const bot = await aiBotRepo.verifyKey(getDb(), key);
    if (!bot) {
      res.status(401).json({ error: "Invalid or disabled bot key", code: "INVALID_BOT_KEY" });
      return;
    }
    (req as any).aiBot = bot;
  } else {
    // Session-cookie path — identity from the verified session, not the client
    const body = (req.body ?? {}) as any;
    const sess = resolveSessionAuth(req, body.bot_id);
    if ("error" in sess) {
      const status = sess.code === "MISSING_BOT_KEY" ? 401 : sess.code === "NO_BOT_BOUND" || sess.code === "BOT_UNAVAILABLE" ? 403 : 401;
      res.status(status).json({ error: sess.error, code: sess.code });
      return;
    }
    (req as any).aiBot = sess.bot;
    (req as any).sessionCtx = { appId: sess.appId, sub: sess.sub, sessionId: sess.sessionId };
  }

  if (!applyRateLimit(req, res)) return;

  let payload;
  try {
    payload = validateBotPayload(req.body);
  } catch (e: any) {
    res.status(400).json({ error: e.message, code: e.code ?? "VALIDATION_ERROR" });
    return;
  }

  const bot = (req as any).aiBot;
  const sessionCtx = (req as any).sessionCtx as { appId: string; sub: string } | undefined;
  // Verified identity wins — client-supplied user.id is ignored for sessions.
  // Session mode scopes the bot to the session's app only (defence in depth).
  const userId = sessionCtx ? sessionCtx.sub : payload.user.id;
  const effectivePermissions = sessionCtx
    ? { [sessionCtx.appId]: (bot.app_permissions ?? {})[sessionCtx.appId] ?? { read: true, write: false } }
    : (bot.app_permissions ?? {});
  const allowedProviderIds = bot.allowed_provider_ids;

  try {
    const result = await runChatAgent(payload.messages, userId, { id: bot.id, name: bot.name, allowedProviderIds, appPermissions: effectivePermissions, rules: bot.rules ?? [], persona: bot.persona ?? '', limits: bot.limits ?? {}, session: sessionCtx ? { appId: sessionCtx.appId, sub: sessionCtx.sub } : undefined });
    res.json(result);
  } catch (e: any) {
    if (e.code === "AI_NOT_CONFIGURED") {
      res.status(503).json({ error: e.message, code: e.code });
      return;
    }
    if (e.code === "AI_PROVIDER_ERROR") {
      res.status(502).json({ error: e.message, code: e.code });
      return;
    }
    console.error("[ai/chat]", e);
    res.status(500).json({ error: e.message ?? "Agent failed", code: "AI_AGENT_ERROR" });
  }
});

// ── MCP router (mounted at /) ─────────────────────────────────────────────────

export const aiMcpRouter = Router();
aiMcpRouter.use(aiGate);

// JSON-RPC 2.0 — single endpoint handles initialize / tools/list / tools/call
aiMcpRouter.post("/mcp", requireBotKey, async (req, res) => {
  const body = req.body as any;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request — expected JSON-RPC 2.0" } });
    return;
  }

  if (!applyRateLimit(req, res)) return;

  const bot = (req as any).aiBot;
  try {
    const response = await handleMcpRequest(body, { id: bot.id, name: bot.name, allowedProviderIds: bot.allowed_provider_ids, appPermissions: bot.app_permissions ?? {}, scopeGuard: bot.limits?.scope_guard });
    // Notifications (no id) get 202 with no body per MCP streamable HTTP
    if (body.id === undefined || body.id === null) {
      res.status(202).end();
      return;
    }
    res.json(response);
  } catch (e: any) {
    console.error("[ai/mcp]", e);
    res.status(500).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32603, message: e.message ?? "Internal error" } });
  }
});
