import { getDb } from "../db/client.js";
import { appRepo } from "../db/repos/appRepo.js";
import { endpointRepo } from "../db/repos/endpointRepo.js";
import { scriptRepo } from "../db/repos/scriptRepo.js";
import { findToolForBot, type ToolDef } from "./toolRegistry.js";
import type { AppPermissionsMap, ScopeGuardConfig } from "../db/repos/aiBotRepo.js";
import { aiToolCallRepo } from "../db/repos/aiToolCallRepo.js";
import { validateInput } from "../runtime/inputValidator.js";
import { applyTransform } from "../runtime/transform.js";
import { buildBody } from "../runtime/bodyBuilder.js";
import { callUpstream } from "../runtime/upstream.js";
import { resolveEnvVars } from "../runtime/router.js";
import { isHostAllowedForOrg } from "../cache/allowlistCache.js";
import { buildContext } from "../runtime/ctxBuilder.js";
import { runScript } from "../runtime/scriptRunner.js";

/**
 * Executes a tool call on behalf of the AI agent.
 *
 * Security layers:
 *   1. Tool must exist in registry (opt-in exposed endpoints, permission-filtered)
 *   2. User-scope guard — user-identifier args must match bound userId
 *   3. Input validation against endpoint schema
 *   4. Full runtime pipeline: script dispatch (if script_mode != "none"),
 *      env resolution, host allowlist, circuit breaker, transform
 *      — identical behaviour to normal runtime traffic
 */

export interface ToolExecutionContext {
  botId: string;
  botName: string;
  userId: string;
  appPermissions: AppPermissionsMap;
  scopeGuard?: ScopeGuardConfig;
  /**
   * Present when the call is authenticated via an app-scoped session (orc_sid)
   * instead of a bot key. When set, tool execution is restricted to this app
   * and userId is the verified session sub.
   */
  session?: { appId: string; sub: string };
}

export interface ToolExecutionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  outcome: "ok" | "tool_error" | "scope_violation" | "denied";
}

/**
 * User scope guard — configured per bot from the dashboard (Limits → User Scope Guard).
 * Disabled by default: the upstream API is the real authority on data access.
 * Enable + configure when you want a pre-upstream audit trail of cross-user attempts.
 */
function checkUserScope(args: Record<string, unknown>, userId: string, guard: ScopeGuardConfig | undefined): string | null {
  if (!guard?.enabled) return null;

  const idArgNames = new Set((guard.id_arg_names ?? []).map(s => s.toLowerCase()));
  let pattern: RegExp | null = null;
  if (guard.id_value_pattern) {
    try { pattern = new RegExp(guard.id_value_pattern, "i"); } catch { /* invalid regex — skip pattern matching */ }
  }

  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "string" || !v) continue;
    const key = k.toLowerCase();
    const looksLikeUserId = idArgNames.has(key) || (pattern !== null && pattern.test(v));
    if (looksLikeUserId && v !== userId) {
      return guard.deny_message
        ?? `Argument '${k}' references a different user — access denied`;
    }
  }
  return null;
}

/**
 * Identity argument detection — args whose value IS the end-user identity.
 * In session mode these are pinned server-side (see executeTool); the LLM's
 * value is discarded, making cross-member access structurally impossible.
 */
export function isIdentityArgName(name: string): boolean {
  return /^(member|user)[_-]?id$/i.test(name);
}

export async function executeTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const db = getDb();
  const started = Date.now();

  const tool = findToolForBot(toolName, ctx.appPermissions);
  if (!tool) {
    aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "denied", detail: "Unknown tool or app not in this bot's assigned list" });
    return { ok: false, error: `Unknown tool '${toolName}' or its app is not assigned to this bot`, outcome: "denied" };
  }

  // ── User-scope guard (configurable from dashboard, disabled by default) ──────
  // NOTE: runs AFTER session identity pinning below, so a pinned id can never
  // trip it — the guard only judges args the model was allowed to influence.
  let scopeViolation: string | null = null;

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

    // ── Session-mode guard + identity pinning ─────────────────────────────────
    // 1. Apps that authenticate end users via orc_sid sessions (auth_required +
    //    auth_mode session/both) must never be reachable with a bare bot key —
    //    that would let a leaked X-Bot-Key read any member's data.
    // 2. WHENEVER a verified session context is present (any app auth mode),
    //    the session owns the identity: it is pinned to this app and any
    //    member/user-id argument is replaced with the session sub. The LLM's
    //    value — correct or hallucinated — is discarded, so cross-member
    //    access is structurally impossible, not merely denied.
    const appAuthMode = (app as any).auth_mode ?? "bearer";
    const sessionAuthApp = Boolean(app.auth_required) && (appAuthMode === "session" || appAuthMode === "both");

    if (sessionAuthApp && !ctx.session) {
      aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "denied", detail: "App requires an authenticated session (auth_required + session auth) — bot-key calls are not accepted", latency_ms: Date.now() - started });
      return { ok: false, error: "This app requires an authenticated end-user session — login first", outcome: "denied" };
    }

    if (ctx.session) {
      if (ctx.session.appId !== tool._exec.app_id) {
        aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "denied", detail: `Session is bound to a different app (${ctx.session.appId})`, latency_ms: Date.now() - started });
        return { ok: false, error: "Session is not valid for this app", outcome: "denied" };
      }

      // Identity args: endpoint-declared when available (works for any domain —
      // memberId, sub, patientId, account_id, …); name-heuristic fallback for
      // endpoints that haven't declared anything.
      const declared: string[] = Array.isArray((ep as any).identity_args) ? (ep as any).identity_args : [];
      const argNames = declared.length
        ? declared
        : [...Object.keys(rawArgs), ...(((ep.path_params ?? []) as any[]).map(p => String(p.name)))].filter(isIdentityArgName);
      for (const name of argNames) {
        if (rawArgs[name] !== ctx.session.sub) {
          const modelValue = rawArgs[name] !== undefined ? String(rawArgs[name]) : "(not provided)";
          rawArgs[name] = ctx.session.sub;
          aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: { [name]: ctx.session.sub }, outcome: "ok", detail: `Identity pin: '${name}' forced to session sub — model supplied: ${modelValue}` });
        }
      }
    }

    // Scope guard runs on PINNED args — the session identity can never violate it.
    scopeViolation = checkUserScope(rawArgs, ctx.userId, ctx.scopeGuard);
    if (scopeViolation) {
      aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "scope_violation", detail: scopeViolation, latency_ms: Date.now() - started });
      return { ok: false, error: scopeViolation, outcome: "scope_violation" };
    }

    // ── Split args into path params / query params / body ────────────────────
    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    const body: Record<string, unknown> = {};

    const pathParamNames = new Set(((ep.path_params ?? []) as any[]).map((p: any) => p.name));
    const queryParamNames = new Set(((ep.query_params ?? []) as any[]).map((q: any) => q.frontend_param));

    for (const [k, v] of Object.entries(rawArgs)) {
      if (pathParamNames.has(k)) pathParams[k] = String(v);
      else if (queryParamNames.has(k)) queryParams[k] = String(v);
      else body[k] = v;
    }

    // ── Input validation ─────────────────────────────────────────────────────
    const request = (ep.request ?? {}) as any;
    if (["POST", "PUT", "PATCH"].includes(ep.method) && request.input_schema?.length > 0) {
      const { valid, errors } = validateInput(body, request.input_schema, request.validation);
      if (!valid) {
        const detail = `Validation failed: ${JSON.stringify(errors)}`;
        aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "tool_error", detail, latency_ms: Date.now() - started });
        return { ok: false, error: `Input validation failed: ${JSON.stringify(errors)}`, outcome: "tool_error" };
      }
    }

    const scriptMode = (ep as any).script_mode ?? "none";
    const scriptFileId = (ep as any).script_file_id ?? null;
    const scriptLogs: Array<{ level: string; message: string; data?: Record<string, unknown>; ts: string }> = [];
    const orgId = "";

    // Helper — load and verify a script exists
    function resolveScript() {
      if (!scriptFileId) throw Object.assign(new Error("No script file assigned to this endpoint"), { code: "SCRIPT_LOAD_ERROR" });
      const script = scriptRepo.findById(db, String(scriptFileId));
      if (!script) throw Object.assign(new Error("Assigned script file not found"), { code: "SCRIPT_LOAD_ERROR" });
      return script;
    }

    // ── script_full: entire response from script, no upstream call ───────────
    if (scriptMode === "script_full") {
      const scriptCtx = buildContext(app, orgId, body, pathParams, queryParams, null, scriptLogs);
      const script = resolveScript();
      const scriptResult = await runScript(script as any, scriptCtx, "script_full");
      if (!scriptResult || scriptResult.body === undefined) {
        aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: "tool_error", detail: "Script did not return a response", latency_ms: Date.now() - started });
        return { ok: false, error: "Script did not return a valid response", outcome: "tool_error" };
      }
      let transformed: unknown = scriptResult.body;
      try { transformed = applyTransform(scriptResult.body, (ep.output_schema ?? []) as any, (ep.field_mappings ?? []) as any); } catch { /* keep raw */ }
      const ok = (scriptResult.status ?? 200) < 400;
      aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: ok ? "ok" : "tool_error", detail: ok ? undefined : `Script returned ${scriptResult.status}`, latency_ms: Date.now() - started });
      return ok
        ? { ok: true, result: transformed, outcome: "ok" }
        : { ok: false, error: `Script returned ${scriptResult.status}: ${JSON.stringify(transformed).slice(0, 300)}`, outcome: "tool_error" };
    }

    // ── Build upstream URL + headers ─────────────────────────────────────────
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

    // ── script_pre / script_pre_post: run pre-hook before upstream ───────────
    if (scriptMode === "script_pre" || scriptMode === "script_pre_post") {
      const scriptCtx = buildContext(app, orgId, body, pathParams, queryParams, null, scriptLogs);
      const script = resolveScript();
      const earlyReturn = await runScript(script as any, scriptCtx, "script_pre");
      if (earlyReturn) {
        let transformed: unknown = earlyReturn.body;
        try { transformed = applyTransform(earlyReturn.body, (ep.output_schema ?? []) as any, (ep.field_mappings ?? []) as any); } catch { /* keep raw */ }
        const ok = (earlyReturn.status ?? 200) < 400;
        aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: ok ? "ok" : "tool_error", latency_ms: Date.now() - started });
        return ok
          ? { ok: true, result: transformed, outcome: "ok" }
          : { ok: false, error: `Pre-hook returned ${earlyReturn.status}`, outcome: "tool_error" };
      }
      if (scriptCtx.upstreamOverrides?.url) Object.assign(headers, scriptCtx.upstreamOverrides.headers ?? {});
    }

    // ── Upstream call ────────────────────────────────────────────────────────
    const result = await callUpstream(ep as any, finalUrl, (ep.upstream as any).method ?? tool._exec.method, headers, upstreamBody, null);

    let upstreamJson: unknown;
    try { upstreamJson = JSON.parse(result.body); } catch { upstreamJson = result.body; }

    // ── script_post / script_pre_post: run post-hook on upstream result ──────
    if (scriptMode === "script_post" || scriptMode === "script_pre_post") {
      const scriptCtx = buildContext(app, orgId, body, pathParams, queryParams, null, scriptLogs);
      const script = resolveScript();
      const upstreamArg = { status: result.status, body: upstreamJson, headers: result.headers ?? {} };
      const postResult = await runScript(script as any, scriptCtx, scriptMode === "script_post" ? "script_post" : "script_pre_post", upstreamArg);
      if (postResult) {
        let transformed: unknown = postResult.body;
        try { transformed = applyTransform(postResult.body, (ep.output_schema ?? []) as any, (ep.field_mappings ?? []) as any); } catch { /* keep raw */ }
        const ok = (postResult.status ?? result.status) < 400;
        aiToolCallRepo.record(db, { bot_id: ctx.botId, bot_name: ctx.botName, user_id: ctx.userId, tool_name: toolName, tool_args: rawArgs, outcome: ok ? "ok" : "tool_error", latency_ms: Date.now() - started });
        return ok
          ? { ok: true, result: transformed, outcome: "ok" }
          : { ok: false, error: `Post-hook returned ${postResult.status}`, outcome: "tool_error" };
      }
    }

    // ── Transform + return ───────────────────────────────────────────────────
    let transformed: unknown = upstreamJson;
    try { transformed = applyTransform(upstreamJson, (ep.output_schema ?? []) as any, (ep.field_mappings ?? []) as any); } catch { /* keep raw */ }

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
