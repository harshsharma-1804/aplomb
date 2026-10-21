import { getDb } from "../db/client.js";
import { corsOriginRepo } from "../db/repos/corsOriginRepo.js";
import { config } from "../config/appConfig.js";

let allowedOrigins: string[] = [];
let allowAll = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function reload(): void {
  const entries = corsOriginRepo.list(getDb()).map(e => e.origin);
  const merged = Array.from(new Set([...config.cors.runtimeOrigins, ...entries]));

  if (merged.includes("*")) {
    allowAll = true;
    allowedOrigins = ["*"];
  } else {
    allowAll = false;
    allowedOrigins = merged;
  }
}

export function initCorsCache(): void {
  reload();
  console.log(`[cors] Runtime origin cache loaded: ${allowAll ? "* (open)" : allowedOrigins.length + " origins"}`);

  pollInterval = setInterval(() => { try { reload(); } catch {} }, 30_000);
  pollInterval.unref();
}

export function refreshCorsCache(): void {
  reload();
}

export function stopCorsCachePolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

export function isRuntimeOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowAll) return true;
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

export function getRuntimeOrigins(): string[] {
  return [...allowedOrigins];
}
