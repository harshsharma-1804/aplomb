import { getDb } from "../db/client.js";
import { getToolsForBot } from "./toolRegistry.js";
import type { AppPermissionsMap } from "../db/repos/aiBotRepo.js";
import { aiBotRepo } from "../db/repos/aiBotRepo.js";
import { executeTool, isIdentityArgName } from "./toolExecutor.js";
import { chatCompletion, type LlmMessage, type LlmToolDef } from "./llmClient.js";
import { config } from "../config/appConfig.js";

/**
 * The chat agent: bot conversation in, curated reply out.
 * Stateless — the bot owns conversation history and sends it every time.
 *
 * Message format (bot ↔ gateway):
 *   [ { from: "user"|"bot", to: "bot"|"user", message: string }, ... ]
 */

export interface BotChatMessage {
  from: string;
  to: string;
  message: string;
}

export interface ChatAgentResult {
  messages: BotChatMessage[];
  meta: {
    iterations: number;
    tool_calls: number;
    provider: string;
    model: string;
    warning?: string;
    classified?: "out_of_scope" | "blocked";
  };
}

function mapToLlmMessages(history: BotChatMessage[], userId: string): LlmMessage[] {
  return history.map(m => ({
    role: m.from === "user" ? ("user" as const) : ("assistant" as const),
    content: m.message ?? "",
  }));
}

/**
 * The gateway authors NO behavioural text. The system prompt is exactly the
 * bot's configured persona + rules, joined verbatim. The only text processing
 * is placeholder substitution of verified identity facts, which a bot opts
 * into by using them:
 *   {{member_id}} / {{user_id}} / {{sub}}  → verified identity
 *     (session sub in session mode; the bot-key caller's declared user.id otherwise)
 *   {{member_email}} / {{user_email}}      → verified email (empty when unavailable)
 *
 * Mechanics (identity pinning, scope guard, audit) are enforced in code and
 * do not depend on what the model is told here.
 */
const IDENTITY_FACT_RE = /\{\{(member_id|user_id|sub|member_email|user_email)\}\}/g;

function buildSystemPrompt(userId: string, email: string | null | undefined, persona: string, rules: string[]): string {
  const facts: Record<string, string> = {
    member_id: userId,
    user_id: userId,
    sub: userId,
    member_email: email ?? "",
    user_email: email ?? "",
  };
  const substitute = (text: string) => text.replace(IDENTITY_FACT_RE, (_, key: string) => facts[key] ?? "");
  const lines: string[] = [];
  if (persona?.trim()) lines.push(substitute(persona.trim()));
  for (const rule of rules) {
    if (rule.trim()) lines.push(substitute(rule.trim()));
  }
  return lines.join("\n");
}

function toolsToLlmFormat(appPermissions: AppPermissionsMap): LlmToolDef[] {
  return getToolsForBot(appPermissions).map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Session mode: strip identity-bearing arguments from the tool schemas the LLM
 * sees. Endpoint-declared identity args take precedence; the name heuristic
 * covers endpoints that haven't declared. The gateway injects the verified
 * session sub in executeTool — the model must never supply an identity.
 */
function stripIdentityArgs(tools: LlmToolDef[]): LlmToolDef[] {
  return tools.map(t => {
    const declared: string[] = Array.isArray((t as any).identity_args) ? (t as any).identity_args : [];
    if (declared.length === 0 && !Object.keys((t.function.parameters as any)?.properties ?? {}).some(isIdentityArgName)) {
      return t;
    }
    const params = t.function.parameters as any;
    const props = { ...(params.properties ?? {}) };
    for (const key of Object.keys(props)) {
      if (declared.includes(key) || isIdentityArgName(key)) delete props[key];
    }
    const required: string[] | undefined = Array.isArray(params.required)
      ? params.required.filter((r: string) => !declared.includes(r) && !isIdentityArgName(r))
      : undefined;
    return {
      ...t,
      function: {
        ...t.function,
        parameters: { ...params, properties: props, ...(required ? { required } : {}) },
      },
    };
  });
}


/**
 * Lightweight domain-scope classifier — asks the same LLM one simple
 * YES/NO question before the main agent loop. Fails open (ambiguous → YES).
 */
async function classifyIntent(
  userMessage: string,
  recentMessages: BotChatMessage[],
  scopeDescription: string,
  provider: import("../ai/llmClient.js").LlmProviderConfig,
  contextCount: number
): Promise<boolean> {
  const contextStr = recentMessages.slice(-contextCount).map(m => `${m.from}: ${m.message}`).join("\n");
  const classifyMessages: LlmMessage[] = [
    {
      role: "system",
      content: scopeDescription,   // used as the full system prompt (caller provides the rubric)
    },
    {
      role: "user",
      content: `${contextStr ? `Recent conversation:\n${contextStr}\n\n` : ""}User message: "${userMessage}"\nClassify: YES or NO`,
    },
  ];
  try {
    const resp = await chatCompletion(provider, classifyMessages);
    const answer = (resp.content ?? "").trim().toUpperCase();
    if (answer.startsWith("NO")) return false;
    return true; // fail open: ambiguous or YES → allow
  } catch {
    return true; // fail open: classifier error → allow
  }
}

export async function runChatAgent(
  history: BotChatMessage[],
  userId: string,
  bot: { id: string; name: string; allowedProviderIds: string[]; appPermissions: AppPermissionsMap; rules: string[]; persona: string; limits: import("../db/repos/aiBotRepo.js").BotLimits; session?: { appId: string; sub: string; email?: string | null } }
): Promise<ChatAgentResult> {
  const db = getDb();

  // Provider resolution — deny-by-default: bot must have providers assigned.
  // First ACTIVE provider in the admin-assigned order wins; deactivated
  // providers are skipped.
  const provider = aiBotRepo.getActiveProviderFull(db, bot.allowedProviderIds);
  if (!provider) {
    throw Object.assign(
      new Error("No active LLM provider assigned to this bot — ask an admin to assign providers in Settings → AI & MCP"),
      { code: "AI_NOT_CONFIGURED" }
    );
  }


  // ── Domain scope classification (hard gate, optional) ───────────────────────
  const limits = bot.limits ?? {};
  if (limits.scope_enforcement && (limits.scope_description || limits.scope_classification_prompt)) {
    const latestMsg = history[history.length - 1];
    const userQuery = latestMsg?.message ?? "";
    const contextCount = limits.scope_context_messages ?? 4;
    // Use the full classification prompt if provided, otherwise wrap the short description
    const classifierSystemPrompt = limits.scope_classification_prompt
      ?? `You are a domain classifier. Answer only YES or NO.\nDomain: ${limits.scope_description}`;
    const inScope = await classifyIntent(userQuery, history.slice(0, -1), classifierSystemPrompt, provider, contextCount);
    if (!inScope) {
      const refusal = limits.out_of_scope_message ?? "I can only help with questions about the topics available in this application.";
      return {
        messages: [...history, { from: "bot", to: "user", message: refusal }],
        meta: { iterations: 0, tool_calls: 0, provider: provider.name, model: provider.model, classified: "out_of_scope" as const },
      };
    }
  }


  // ── Topic blocklist (hard pre-LLM filter) ────────────────────────────────────
  if (limits.topic_blocklist?.length) {
    const latestMsg = history[history.length - 1]?.message?.toLowerCase() ?? "";
    const blocked = limits.topic_blocklist.find(phrase => latestMsg.includes(phrase.toLowerCase()));
    if (blocked) {
      const refusal = limits.out_of_scope_message ?? "I can only help with questions about the topics available in this application.";
      return {
        messages: [...history, { from: "bot", to: "user", message: refusal }],
        meta: { iterations: 0, tool_calls: 0, provider: provider.name, model: provider.model, classified: "blocked" as const },
      };
    }
  }

  const maxIter = limits.max_tool_calls ?? config.ai.maxIterations;
  const maxHistory = limits.max_history_messages;

  // Trim history if max_history_messages is set (keep most recent messages)
  const trimmedHistory = maxHistory && history.length > maxHistory
    ? history.slice(history.length - maxHistory)
    : history;

  const tools = bot.session
    ? stripIdentityArgs(toolsToLlmFormat(bot.appPermissions))
    : toolsToLlmFormat(bot.appPermissions);
  const llmMessages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(userId, bot.session?.email, bot.persona, bot.rules) },
    ...mapToLlmMessages(trimmedHistory, userId),
  ];

  let iterations = 0;
  let toolCallsMade = 0;
  let warning: string | undefined;
  let finalContent: string | null = null;

  while (iterations < maxIter) {
    iterations++;

    const response = await chatCompletion(provider, llmMessages, tools);

    if (response.tool_calls.length === 0) {
      finalContent = response.content;
      break;
    }

    // Assistant turn with tool calls must be appended before tool results
    llmMessages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls.map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      })),
    });

    for (const tc of response.tool_calls) {
      toolCallsMade++;
      const exec = await executeTool(tc.name, tc.args, { botId: bot.id, botName: bot.name, userId, appPermissions: bot.appPermissions, scopeGuard: limits.scope_guard, session: bot.session });
      llmMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: exec.ok
          ? JSON.stringify(exec.result)
          : JSON.stringify({ error: exec.error, scope_violation: exec.outcome === "scope_violation" }),
      });
    }
  }

  if (iterations >= config.ai.maxIterations && finalContent === null) {
    // Budget exhausted — one last call WITHOUT tools to force a text answer
    const response = await chatCompletion(provider, [
      ...llmMessages,
      { role: "user", content: "(system: tool budget exhausted — summarise what you have so far and answer the user now, do not request more tools)" },
    ]);
    finalContent = response.content;
    warning = "Tool call budget exhausted — response may be incomplete";
    if (limits.fallback_message) finalContent = limits.fallback_message;
  }



  // ── Max response words ───────────────────────────────────────────────────────
  if (limits.max_response_words && finalContent) {
    const words = finalContent.split(/\s+/);
    if (words.length > limits.max_response_words) {
      finalContent = words.slice(0, limits.max_response_words).join(" ") + "…";
    }
  }

  // ── Tool-only mode: discard response if no tool was called ───────────────────
  if (limits.tool_only_mode && toolCallsMade === 0 && finalContent !== null) {
    finalContent = limits.tool_only_refusal ?? "I can only answer questions using the available data tools for your account. Please ask about your specific account information.";
  }

  const reply: BotChatMessage = {
    from: "bot",
    to: "user",
    message: finalContent ?? "I could not generate a response — please try again.",
  };

  return {
    messages: [...history, reply],
    meta: {
      iterations,
      tool_calls: toolCallsMade,
      provider: provider.name,
      model: provider.model,
      ...(warning ? { warning } : {}),
    },
  };
}

export function validateBotPayload(payload: any): { user?: { id: string }; messages: BotChatMessage[] } {
  if (!payload || !Array.isArray(payload.messages)) {
    throw Object.assign(new Error("Body must be { messages: [{from, to, message}, ...] } — user.id only required for bot-key auth"), { code: "VALIDATION_ERROR" });
  }
  if (payload.messages.length === 0) {
    throw Object.assign(new Error("messages array must not be empty"), { code: "VALIDATION_ERROR" });
  }
  for (const m of payload.messages) {
    if (typeof m.from !== "string" || typeof m.to !== "string" || typeof m.message !== "string") {
      throw Object.assign(new Error('Each message must be { from: string, to: string, message: string }'), { code: "VALIDATION_ERROR" });
    }
  }
  // user.id is OPTIONAL — session-cookie callers don't send it (identity comes
  // from the orc_sid session server-side). Bot-key callers must supply it; that
  // requirement is enforced in the route, not here.
  const userId = payload.user?.id;
  if (userId !== undefined && typeof userId !== "string") {
    throw Object.assign(new Error("user.id must be a string when provided"), { code: "VALIDATION_ERROR" });
  }
  return { user: userId ? { id: userId } : undefined, messages: payload.messages as BotChatMessage[] };
}
