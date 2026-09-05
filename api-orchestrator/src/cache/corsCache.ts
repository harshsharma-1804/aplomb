import { CorsOrigin } from "../models/CorsOrigin.js";
import { config } from "../config/appConfig.js";

let allowedOrigins: string[] = [];
let allowAll = false;

async function reload(): Promise<void> {
  const entries = await CorsOrigin.find().lean();
  const fromDb = entries.map(e => e.origin);

  // Merge DB entries with env var seeds
  const merged = Array.from(new Set([...config.cors.runtimeOrigins, ...fromDb]));

  if (merged.includes("*")) {
    allowAll = true;
    allowedOrigins = ["*"];
  } else {
    allowAll = false;
    allowedOrigins = merged;
  }
}

export async function initCorsCache(): Promise<void> {
  await reload();
  console.log(`[cors] Runtime origin cache loaded: ${allowAll ? "* (open)" : allowedOrigins.length + " origins"}`);

  try {
    const changeStream = CorsOrigin.watch([], { fullDocument: "updateLookup" });
    changeStream.on("change", async () => { await reload(); });
    changeStream.on("error", () => {});
  } catch {
    console.info("[cors] Origin change stream unavailable — cache will not auto-refresh.");
  }
}

export async function refreshCorsCache(): Promise<void> {
  await reload();
}

/**
 * Check if a given Origin header value is allowed for runtime requests.
 * Returns true if:
 *  - allowAll (*) is set
 *  - origin is in the allowed list
 *  - no origins are configured (open by default — warn in logs)
 *  - origin is undefined (non-browser server-to-server call — allow)
 */
export function isRuntimeOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;            // server-to-server — no Origin header
  if (allowAll) return true;
  if (allowedOrigins.length === 0) return true;  // no restrictions configured
  return allowedOrigins.includes(origin);
}

export function getRuntimeOrigins(): string[] {
  return [...allowedOrigins];
}
