import { getDb } from "../db/client.js";
import { getToolsForBot } from "./toolRegistry.js";
import type { AppPermissionsMap } from "../db/repos/aiBotRepo.js";
import { aiBotRepo } from "../db/repos/aiBotRepo.js";
import { executeTool } from "./toolExecutor.js";
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

function buildSystemPrompt(userId: string, persona: string, rules: string[]): string {
  const lines: string[] = [];

  if (persona?.trim()) {
    lines.push(persona.trim(), "");
  } else {
    lines.push("You are the API assistant for an organisation's gateway. You help the end user by calling the available API tools.", "");
  }

  lines.push(
    `IMPORTANT — USER SCOPING: you are assisting user/member "${userId}" ONLY.`,
    `Every data request must be scoped to this user. Never request, query, or reference another user's or member's data. The system enforces this: tool calls referencing a different user id are blocked.`,
    ``,
    `GUIDELINES:`,
    `- Use the provided tools to answer questions. Prefer calling a tool over guessing.`,
    `- If multiple tool calls are needed, make them one at a time as you receive results.`,
    `- If a tool returns an error, explain it simply to the user — do not expose raw stack traces or internal details.`,
    `- Answer in the same language and tone as the user's question.`,
    `- Format answers for a chat interface: use plain text with bullet points or simple tables when listing items. Do not output raw JSON unless the user asks for it.`,
    `- If the question cannot be answered with the available tools, say so clearly and suggest what the user can ask instead.`,
  );

  if (rules.length > 0) {
    lines.push(
      ``,
      `BOT-SPECIFIC RULES (HIGHEST PRIORITY — YOU MUST FOLLOW THESE ABOVE ALL OTHER GUIDELINES):`,
      `These rules are set by the administrator. If a user request violates any rule, politely decline and briefly explain what you can help with instead.`,
      ...rules.map((r, i) => `${i + 1}. ${r}`),
    );
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
      content: `You are a domain classifier. Answer only YES or NO.\nDomain: ${scopeDescription}`,
    },
    {
      role: "user",
      content: `${contextStr ? `Recent conversation:\n${contextStr}\n\n` : ""}Question: "${userMessage}"\nIs this question within the domain described above? Answer YES or NO only.`,
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
  bot: { id: string; name: string; allowedProviderIds: string[]; appPermissions: AppPermissionsMap; rules: string[]; persona: string; limits: import("../db/repos/aiBotRepo.js").BotLimits }
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
  if (limits.scope_enforcement && limits.scope_description) {
    const latestMsg = history[history.length - 1];
    const userQuery = latestMsg?.message ?? "";
    const contextCount = limits.scope_context_messages ?? 4;
    const inScope = await classifyIntent(userQuery, history.slice(0, -1), limits.scope_description, provider, contextCount);
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

  const tools = toolsToLlmFormat(bot.appPermissions);
  const llmMessages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(userId, bot.persona, bot.rules) },
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
      const exec = await executeTool(tc.name, tc.args, { botId: bot.id, botName: bot.name, userId, appPermissions: bot.appPermissions });
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

export function validateBotPayload(payload: any): { user: { id: string }; messages: BotChatMessage[] } {
  if (!payload || !Array.isArray(payload.messages)) {
    throw Object.assign(new Error("Body must be { user: {id}, messages: [{from, to, message}, ...] }"), { code: "VALIDATION_ERROR" });
  }
  if (payload.messages.length === 0) {
    throw Object.assign(new Error("messages array must not be empty"), { code: "VALIDATION_ERROR" });
  }
  for (const m of payload.messages) {
    if (typeof m.from !== "string" || typeof m.to !== "string" || typeof m.message !== "string") {
      throw Object.assign(new Error('Each message must be { from: string, to: string, message: string }'), { code: "VALIDATION_ERROR" });
    }
  }
  const userId = payload.user?.id;
  if (!userId || typeof userId !== "string") {
    throw Object.assign(new Error("user.id is required — the bot must bind the chat to the authenticated end user"), { code: "USER_CONTEXT_REQUIRED" });
  }
  return { user: { id: userId }, messages: payload.messages as BotChatMessage[] };
}
