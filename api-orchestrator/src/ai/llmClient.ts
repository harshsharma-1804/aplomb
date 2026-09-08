import { createDecipheriv } from "crypto";
import { config } from "../config/appConfig.js";

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
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

export function decryptProviderKey(provider: LlmProviderConfig): string {
  const keyEnv = config.secrets.encryptionKey;
  if (keyEnv.length !== config.secrets.keyLengthRequired) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must be exactly ${config.secrets.keyLengthRequired} ASCII characters`);
  }
  const key = Buffer.from(keyEnv, "utf8");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(provider.iv, "base64"));
  decipher.setAuthTag(Buffer.from(provider.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(provider.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
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
  const apiKey = decryptProviderKey(provider);
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
