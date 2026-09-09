import { getToolsForBot } from "./toolRegistry.js";
import type { AppPermissionsMap } from "../db/repos/aiBotRepo.js";
import { executeTool } from "./toolExecutor.js";

/**
 * Model Context Protocol (MCP) server over Streamable HTTP (JSON-RPC 2.0).
 * Lets external AI clients (Claude Desktop, Cursor, custom bots) discover
 * and call the gateway's AI-exposed endpoints as MCP tools.
 *
 * Supported methods:
 *   initialize          → protocol handshake
 *   notifications/initialized → acknowledged (no-op)
 *   tools/list          → tool catalog
 *   tools/call          → executes a tool (requires bound user context)
 *
 * MCP client auth: same bot-key middleware as /__ai/chat.
 * Per-user scoping: tools/call requires params._meta.orchestrator_user_id —
 * external clients bind the end user the same way the chat endpoint does.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

const PROTOCOL_VERSION = "2025-03-26";

function err(id: any, code: number, message: string, data?: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function ok(id: any, result: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export async function handleMcpRequest(
  body: JsonRpcRequest,
  bot: { id: string; name: string; allowedProviderIds: string[]; appPermissions: AppPermissionsMap; scopeGuard?: import("../db/repos/aiBotRepo.js").ScopeGuardConfig }
): Promise<JsonRpcResponse> {
  const id = body.id ?? null;

  switch (body.method) {
    case "initialize": {
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true } },
        serverInfo: {
          name: "orchestrator-mcp",
          version: "1.0.0",
          description: "API orchestrator gateway — AI-exposed endpoints as MCP tools",
        },
      });
    }

    case "notifications/initialized": {
      // Notification — no response body per JSON-RPC; caller ignores id-less responses
      return ok(id, {});
    }

    case "tools/list": {
      // Per-bot catalog — deny-by-default: bot must have apps assigned
      const tools = getToolsForBot(bot.appPermissions).map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters,
      }));
      return ok(id, { tools });
    }

    case "tools/call": {
      const name = body.params?.name;
      const args = body.params?.arguments ?? {};
      if (typeof name !== "string") {
        return err(id, -32602, "params.name is required");
      }

      // Per-user binding — same contract as the chat endpoint
      const userId = body.params?._meta?.orchestrator_user_id ?? body.params?.orchestrator_user_id;
      if (!userId || typeof userId !== "string") {
        return err(id, -32602, "params._meta.orchestrator_user_id is required — bind the end user the same way /__ai/chat does", { code: "USER_CONTEXT_REQUIRED" });
      }

      const exec = await executeTool(name, args, { botId: bot.id, botName: bot.name, userId, appPermissions: bot.appPermissions, scopeGuard: bot.scopeGuard });

      // MCP tool result content format
      return ok(id, {
        content: [
          {
            type: "text",
            text: exec.ok
              ? JSON.stringify(exec.result, null, 2)
              : `Error: ${exec.error}`,
          },
        ],
        isError: !exec.ok,
      });
    }

    case "ping": {
      return ok(id, {});
    }

    default:
      return err(id, -32601, `Method not found: ${body.method}`);
  }
}
