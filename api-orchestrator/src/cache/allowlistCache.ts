import { getDb } from "../db/client.js";
import { hostAllowlistRepo } from "../db/repos/hostAllowlistRepo.js";
import { config } from "../config/appConfig.js";

interface AllowlistEntry { hostname: string; is_wildcard: boolean; }

let entries: AllowlistEntry[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;

function reload(): void {
  entries = hostAllowlistRepo.list(getDb()).map(e => ({ hostname: e.hostname, is_wildcard: e.is_wildcard }));
}

export function initAllowlistCache(): void {
  reload();
  console.log(`[cache] Host allowlist loaded: ${entries.length} entries`);

  pollInterval = setInterval(() => { try { reload(); } catch {} }, 30_000);
  pollInterval.unref();
}

export function refreshAllowlistCache(): void { reload(); }

export function stopAllowlistCachePolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
];

function isPrivate(hostname: string): boolean {
  return PRIVATE_RANGES.some(r => r.test(hostname));
}

function matchesEntry(hostname: string, entry: AllowlistEntry): boolean {
  if (entry.is_wildcard) {
    const domain = entry.hostname.slice(2);
    return hostname === domain || hostname.endsWith("." + domain);
  }
  return hostname === entry.hostname;
}

export function isHostAllowedForOrg(url: string, _orgId: string): boolean {
  if (url.includes("{{")) return true;

  let hostname: string;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (entries.length > 0) {
    return entries.some(e => matchesEntry(hostname, e));
  }

  // No DB entries yet — fall back to env var (bootstrap path)
  const envList = config.upstream.hostAllowlist;
  if (envList.length === 0) return true;

  const matchesEnv = envList.some(allowed => {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return hostname === domain || hostname.endsWith("." + domain);
    }
    return hostname === allowed;
  });

  if (!matchesEnv) return false;
  if (config.upstream.blockPrivateRanges && isPrivate(hostname)) return envList.includes(hostname);
  return true;
}

export function getAllowlistEntries(): AllowlistEntry[] {
  return [...entries];
}
