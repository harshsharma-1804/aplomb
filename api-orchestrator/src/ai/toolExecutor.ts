import { getDb } from "../db/client.js";
import { appRepo } from "../db/repos/appRepo.js";
import { endpointRepo } from "../db/repos/endpointRepo.js";
import { findToolForBot, type ToolDef } from "./toolRegistry.js";
import { aiToolCallRepo } from "../db/repos/aiToolCallRepo.js";
import { validateInput } from "../runtime/inputValidator.js";
import { applyTransform } from "../runtime/transform.js";
import { buildBody } from "../runtime/bodyBuilder.js";
import { callUpstream } from "../runtime/upstream.js";
import { resolveEnvVars } from "../runtime/router.js";
import { isHostAllowedForOrg } from "../cache/allowlistCache.js";

/**
 * Executes a tool call on behalf of the AI agent.
 *
 * Security layers applied here:
 *   1. Tool must exist in the registry (opt-in exposed endpoints only)
 *   2. User-scope guard — any user-identifier arg must match the authenticated
 *      end user bound to the chat request; mismatches are blocked + audited
 *   3. Input validation against the endpoint's schema
 *   4. Full runtime pipeline: env resolution → allowlist → circuit breaker
 *      + pool → transform (identical to normal traffic)
 */

export interface ToolExecutionContext {
  botId: string;
  botName: string;
  userId: string;
  allowedAppIds: string[];
}

export interface ToolExecutionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  outcome: "ok" | "tool_error" | "scope_violation" | "denied";
}

// Argument keys that reference an end-user identifier
const USER_ID_KEYS = new Set(["memberid", "user_id", "member_id", "userid", "memberid", "id"]);
const USER_ID_VALUE_PATTERN = /^(MED|USR|MBR)[-_]?\w+/i;

function checkUserScope(tool: ToolDef, args: Record<string, unknown>, userId: string): string | null {
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "string" || !v) continue;
    const key = k.toLowerCase();
    const looksLikeUserId = USER_ID_KEYS.has(key) || (key === "id" && USER_ID_VALUE_PATTERN.test(v));
    if (looksLikeUserId && v !== userId) {
      return `Argument '${k}' references user '${v}' but this session is bound to user '${userId}' — access denied`;
    }
  }
  return null;
}

export async function executeTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const db = getDb();
  const started = Date.now();

  const tool = findToolForBot(toolName, ctx.allowedAppIds);
  if (!tool) {
    aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "denied", detail: "Unknown tool or app not in this bot's assigned list" });
    return { ok: false, error: `Unknown tool '${toolName}' or its app is not assigned to this bot`, outcome: "denied" };
  }

  // ── User-scope guard ────────────────────────────────────────────────────────
  const scopeViolation = checkUserScope(tool, rawArgs, ctx.userId);
  if (scopeViolation) {
    aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "scope_violation", detail: scopeViolation, latency_ms: Date.now() - started });
    return { ok: false, error: scopeViolation, outcome: "scope_violation" };
  }

  try {
    const app = appRepo.findById(db, tool._exec.app_id);
    if (!app) {
      aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "tool_error", detail: "App not found", latency_ms: Date.now() - started });
      return { ok: false, error: "Tool's app no longer exists", outcome: "tool_error" };
    }

    const ep = endpointRepo.findById(db, tool._exec.endpoint_id);
    if (!ep || !ep.is_active) {
      aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "tool_error", detail: "Endpoint inactive", latency_ms: Date.now() - started });
      return { ok: false, error: "Tool's endpoint is inactive", outcome: "tool_error" };
    }

    // ── Split args: path params + query params + body ────────────────────────
    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    const body: Record<string, unknown> = {};

    const pathParamNames = new Set(((ep.path_params ?? []) as any[]).map(p => p.name));
    const queryParamNames = new Set(((ep.query_params ?? []) as any[]).map(q => q.frontend_param));

    for (const [k, v] of Object.entries(rawArgs)) {
      if (pathParamNames.has(k)) pathParams[k] = String(v);
      else if (queryParamNames.has(k)) queryParams[k] = String(v);
      else body[k] = v;
    }

    // ── Validate body against input schema (same as normal traffic) ──────────
    const request = (ep.request ?? {}) as any;
    if (["POST", "PUT", "PATCH"].includes(ep.method) && request.input_schema?.length > 0) {
      const { valid, errors } = validateInput(body, request.input_schema, request.validation);
      if (!valid) {
        const detail = `Validation failed: ${JSON.stringify(errors)}`;
        aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "tool_error", detail, latency_ms: Date.now() - started });
        return { ok: false, error: `Input validation failed: ${JSON.stringify(errors)}`, outcome: "tool_error" };
      }
    }

    // ── Build upstream request (same pipeline as runtime) ────────────────────
    const urlTemplate = await resolveEnvVars((ep.upstream as any).url ?? "", app);
    const resolvedUrl = urlTemplate.replace(/\{([^}]+)\}/g, (match: string, name: string) => {
      const val = pathParams[name] ?? pathParams[name.toLowerCase()];
      return val !== undefined ? encodeURIComponent(val) : match;
    });

    const qs = new URLSearchParams(queryParams).toString();
    const finalUrl = qs ? `${resolvedUrl}?${qs}` : resolvedUrl;

    if (!isHostAllowedForOrg(finalUrl, "")) {
      aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "denied", detail: "Host not allowed", latency_ms: Date.now() - started });
      return { ok: false, error: "Upstream host not allowed", outcome: "denied" };
    }

    const hasBody = ["POST", "PUT", "PATCH"].includes(ep.method) && Object.keys(body).length > 0;
    const { body: upstreamBody } = hasBody && !(ep.upstream as any).body_passthrough
      ? buildBody((ep.upstream as any).body_mappings ?? [], (ep.upstream as any).body_content_type, (ep.upstream as any).body_passthrough, (ep.upstream as any).form_encoding, body, queryParams, pathParams, null)
      : { body: hasBody ? JSON.stringify(body) : null };

    const headers: Record<string, string> = {};
    for (const sh of (ep.upstream as any).static_headers ?? []) {
      if (sh.name) headers[sh.name] = await resolveEnvVars(sh.value ?? "", app);
    }

    const result = await callUpstream(ep as any, finalUrl, (ep.upstream as any).method ?? tool._exec.method, headers, upstreamBody, null);

    let upstreamJson: unknown;
    try { upstreamJson = JSON.parse(result.body); } catch { upstreamJson = result.body; }

    let transformed: unknown = upstreamJson;
    try {
      transformed = applyTransform(upstreamJson, (ep.output_schema ?? []) as any, (ep.field_mappings ?? []) as any);
    } catch { /* keep raw */ }

    const latency = Date.now() - started;
    const ok = result.status < 400;
    aiToolCallRepo.record(db, {
      bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId,
      tool_name: toolName, tool_args: rawArgs,
      outcome: ok ? "ok" : "tool_error",
      detail: ok ? undefined : `Upstream ${result.status}`,
      latency_ms: latency,
    });

    return ok
      ? { ok: true, result: transformed, outcome: "ok" }
      : { ok: false, error: `Upstream returned ${result.status}: ${JSON.stringify(upstreamJson).slice(0, 500)}`, outcome: "tool_error" };

  } catch (e: any) {
    aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "tool_error", detail: e.message ?? "Unknown error", latency_ms: Date.now() - started });
    return { ok: false, error: e.message ?? "Tool execution failed", outcome: "tool_error" };
  }
}
