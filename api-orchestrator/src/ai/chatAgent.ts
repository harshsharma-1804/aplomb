import { getDb } from "../db/client.js";
import { aiProviderRepo } from "../db/repos/aiProviderRepo.js";
import { getTools } from "./toolRegistry.js";
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
  };
}

function mapToLlmMessages(history: BotChatMessage[], userId: string): LlmMessage[] {
  return history.map(m => ({
    role: m.from === "user" ? ("user" as const) : ("assistant" as const),
    content: m.message ?? "",
  }));
}

function buildSystemPrompt(userId: string): string {
  return [
    `You are the API assistant for an organisation's gateway. You help the end user by calling the available API tools.`,
    ``,
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
  ].join("\n");
}

function toolsToLlmFormat(): LlmToolDef[] {
  return getTools().map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function runChatAgent(
  history: BotChatMessage[],
  userId: string,
  bot: { id: string; name: string }
): Promise<ChatAgentResult> {
  const db = getDb();

  const provider = aiProviderRepo.getActiveFull(db);
  if (!provider) {
    throw Object.assign(new Error("No active AI provider configured — ask an admin to add one in Settings → AI Providers"), { code: "AI_NOT_CONFIGURED" });
  }

  const tools = toolsToLlmFormat();
  const llmMessages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt(userId) },
    ...mapToLlmMessages(history, userId),
  ];

  let iterations = 0;
  let toolCallsMade = 0;
  let warning: string | undefined;
  let finalContent: string | null = null;

  while (iterations < config.ai.maxIterations) {
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
      const exec = await executeTool(tc.name, tc.args, { botId: bot.id, botName: bot.name, userId });
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
