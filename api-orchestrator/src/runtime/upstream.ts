import { fetch as undiciFetch } from "undici";
import CircuitBreaker from "opossum";
import { resolveSecret } from "../secrets/resolver.js";
import { config } from "../config/appConfig.js";

const breakers = new Map<string, CircuitBreaker>();
const ALLOWED_RETRY_METHODS = new Set(["GET", "HEAD"]);

function getBreaker(host: string): CircuitBreaker {
  if (breakers.has(host)) return breakers.get(host)!;

  const breaker = new CircuitBreaker(
    async (url: string, init: RequestInit) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]),
    {
      timeout: config.upstream.timeoutMs,
      errorThresholdPercentage: config.upstream.circuitBreakerErrorThresholdPct,
      resetTimeout: config.upstream.circuitBreakerResetTimeoutMs,
      volumeThreshold: config.upstream.circuitBreakerVolumeThreshold,
    }
  );

  breaker.on("open", () => console.warn(`[upstream] Circuit OPEN for ${host}`));
  breaker.on("halfOpen", () => console.info(`[upstream] Circuit HALF-OPEN for ${host}`));
  breaker.on("close", () => console.info(`[upstream] Circuit CLOSED for ${host}`));

  breakers.set(host, breaker);
  return breaker;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(base: number): number {
  return base + Math.floor(Math.random() * base * 0.3);
}

export async function callUpstream(
  endpoint: any,
  upstreamUrl: string,
  upstreamMethod: string,
  headers: Record<string, string>,
  body: string | null,
  idempotencyKey: string | null
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const isIdempotent = ALLOWED_RETRY_METHODS.has(upstreamMethod.toUpperCase());
  const canRetry = isIdempotent || idempotencyKey !== null;
  const maxAttempts = canRetry ? config.upstream.maxRetries : 1;

  const reqHeaders: Record<string, string> = { ...headers };

  if (endpoint.upstream.auth_type !== "none" && endpoint.upstream.auth_type !== "forward_cookie") {
    const secretRef = endpoint.upstream.auth_config?.secret_ref;
    if (secretRef) {
      const secretValue = resolveSecret(String(secretRef));
      if (endpoint.upstream.auth_type === "bearer") {
        reqHeaders["Authorization"] = `Bearer ${secretValue}`;
      } else if (endpoint.upstream.auth_type === "apikey") {
        const headerName = endpoint.upstream.auth_config?.header_name ?? "X-API-Key";
        reqHeaders[headerName] = secretValue;
      }
    }
  }

  if (idempotencyKey) reqHeaders["Idempotency-Key"] = idempotencyKey;
  if (body) {
    reqHeaders["Content-Type"] = endpoint.upstream.body_content_type;
    reqHeaders["Content-Length"] = String(Buffer.byteLength(body));
  }

  const hostname = new URL(upstreamUrl).hostname;
  const breaker = getBreaker(hostname);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(jitter(200 * Math.pow(2, attempt - 1)));

    try {
      const response = await breaker.fire(upstreamUrl, {
        method: upstreamMethod,
        headers: reqHeaders,
        body: body ?? undefined,
      }) as Response;

      const responseBody = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => { responseHeaders[k] = v; });

      return { status: response.status, body: responseBody, headers: responseHeaders };
    } catch (err) {
      lastError = err as Error;
      if (!canRetry) break;
    }
  }

  throw lastError ?? new Error("Upstream call failed");
}
