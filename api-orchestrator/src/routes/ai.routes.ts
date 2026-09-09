import { Router, type Request, type Response, type NextFunction } from "express";
import { getDb } from "../db/client.js";
import { aiBotRepo } from "../db/repos/aiBotRepo.js";
import { runChatAgent, validateBotPayload } from "../ai/chatAgent.js";
import { handleMcpRequest } from "../ai/mcpServer.js";
import { config } from "../config/appConfig.js";

/**
 * AI zone — feature-flagged by AI_ENABLED (404 when off).
 *
 * POST /__ai/chat   — chatbot conversations: bot-key auth + end-user binding
 * POST /mcp         — MCP JSON-RPC 2.0 endpoint for external AI clients
 *
 * Both authenticate with X-Bot-Key (registered via dashboard Admin → AI Bots).
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

// ── Chat router (mounted at /__ai) ────────────────────────────────────────────

export const aiChatRouter = Router();
aiChatRouter.use(aiGate);

aiChatRouter.post("/chat", requireBotKey, async (req, res) => {
  let payload;
  try {
    payload = validateBotPayload(req.body);
  } catch (e: any) {
    res.status(400).json({ error: e.message, code: e.code ?? "VALIDATION_ERROR" });
    return;
  }

  const bot = (req as any).aiBot;

  try {
    const result = await runChatAgent(payload.messages, payload.user.id, { id: bot.id, name: bot.name, allowedProviderIds: bot.allowed_provider_ids, appPermissions: bot.app_permissions ?? {}, rules: bot.rules ?? [], persona: bot.persona ?? '', limits: bot.limits ?? {} });
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
