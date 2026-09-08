import { config } from "../config/appConfig.js";
import { resolveSecret } from "../secrets/resolver.js";

/**
 * Minimal OpenAI-compatible chat-completions client with tool calling.
 * Works with OpenAI, Azure OpenAI (via base_url), OpenRouter, Ollama, vLLM, etc.
 * Provider + key come from the admin-managed ai_providers table — no env config.
 */

export interface LlmToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface LlmProviderConfig {
  id: string;
  name: string;
  base_url: string;
  model: string;
  secret_id: string | null;
}

/**
 * Resolves the provider API key at call time from the Secrets vault —
 * never stored in memory longer than the request, never logged,
 * never included in LLM messages. Plain-value keys are not supported.
 */
export function resolveProviderKey(provider: LlmProviderConfig): string {
  if (!provider.secret_id) {
    throw new Error(`Provider '${provider.name}' has no vault secret assigned — assign one in Settings → AI & MCP`);
  }
  return resolveSecret(provider.secret_id);
}

export interface LlmResponse {
  content: string | null;
  tool_calls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

export async function chatCompletion(
  provider: LlmProviderConfig,
  messages: LlmMessage[],
  tools?: LlmToolDef[]
): Promise<LlmResponse> {
  const apiKey = resolveProviderKey(provider);
  const url = `${provider.base_url.replace(/\/$/, "")}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.llmTimeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw Object.assign(new Error(`LLM request timed out after ${config.ai.llmTimeoutMs}ms`), { code: "AI_PROVIDER_ERROR" });
    }
    throw Object.assign(new Error(`LLM unreachable: ${e.message}`), { code: "AI_PROVIDER_ERROR" });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`LLM provider returned ${res.status}: ${body.slice(0, 300)}`),
      { code: "AI_PROVIDER_ERROR" }
    );
  }

  const data = await res.json() as any;
  const choice = data.choices?.[0];
  if (!choice) {
    throw Object.assign(new Error("LLM provider returned no choices"), { code: "AI_PROVIDER_ERROR" });
  }

  const rawToolCalls = (choice.message?.tool_calls ?? []).map((tc: any) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* empty */ }
    return { id: tc.id ?? "", name: tc.function?.name ?? "", args };
  });

  return {
    content: choice.message?.content ?? null,
    tool_calls: rawToolCalls,
  };
}
