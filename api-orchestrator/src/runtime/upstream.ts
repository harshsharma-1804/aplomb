import { Pool } from "undici";
import CircuitBreaker from "opossum";
import { resolveSecret } from "../secrets/resolver.js";
import { config } from "../config/appConfig.js";

const breakers = new Map<string, CircuitBreaker>();
const pools = new Map<string, Pool>();
const ALLOWED_RETRY_METHODS = new Set(["GET", "HEAD"]);

/**
 * Get or create a keep-alive connection Pool for an upstream origin.
 * Reusing TCP+TLS connections saves 50–150ms TLS handshake per request.
 */
function getPool(origin: string): Pool {
  if (pools.has(origin)) return pools.get(origin)!;
  const pool = new Pool(origin, {
    connections:          10,
    keepAliveTimeout:     30_000,
    keepAliveMaxTimeout:  600_000,
    headersTimeout:       config.upstream.timeoutMs,
    bodyTimeout:          config.upstream.timeoutMs,
    connectTimeout:       10_000,
  });
  pools.set(origin, pool);
  return pool;
}

function getBreaker(host: string): CircuitBreaker {
  if (breakers.has(host)) return breakers.get(host)!;

  const breaker = new CircuitBreaker(
    async (origin: string, path: string, method: string, headers: Record<string, string>, body: string | null) => {
      const pool = getPool(origin);
      const response = await pool.request({
        method:  method as any,
        path,
        headers,
        body:    body ?? undefined,
      });
      // Read body as text
      const chunks: Buffer[] = [];
      for await (const chunk of response.body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf-8");
      const responseHeaders: Record<string, string> = {};
      const raw = response.headers;
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw)) {
          if (v !== undefined) responseHeaders[String(k)] = Array.isArray(v) ? v.join(", ") : String(v);
        }
      }
      return { status: response.statusCode, body: text, headers: responseHeaders };
    },
    {
      timeout:                    config.upstream.timeoutMs,
      errorThresholdPercentage:   config.upstream.circuitBreakerErrorThresholdPct,
      resetTimeout:               config.upstream.circuitBreakerResetTimeoutMs,
      volumeThreshold:            config.upstream.circuitBreakerVolumeThreshold,
    }
  );

  breaker.on("open",     () => console.warn(`[upstream] Circuit OPEN for ${host}`));
  breaker.on("halfOpen", () => console.info(`[upstream] Circuit HALF-OPEN for ${host}`));
  breaker.on("close",    () => console.info(`[upstream] Circuit CLOSED for ${host}`));

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

  const parsed = new URL(upstreamUrl);
  const origin  = parsed.origin;                                // e.g. https://api.example.com
  const path    = parsed.pathname + parsed.search;              // e.g. /claims?status=active
  const breaker = getBreaker(parsed.hostname);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(jitter(200 * Math.pow(2, attempt - 1)));

    try {
      const result = await breaker.fire(origin, path, upstreamMethod, reqHeaders, body) as {
        status: number; body: string; headers: Record<string, string>;
      };
      return result;
    } catch (err) {
      lastError = err as Error;
      if (!canRetry) break;
    }
  }

  throw lastError ?? new Error("Upstream call failed");
}
