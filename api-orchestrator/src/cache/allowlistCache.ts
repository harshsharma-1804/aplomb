import { HostAllowlist } from "../models/HostAllowlist.js";
import { config } from "../config/appConfig.js";

interface AllowlistEntry { hostname: string; is_wildcard: boolean; }

const cache = new Map<string, AllowlistEntry[]>();

async function reload(): Promise<void> {
  const entries = await HostAllowlist.find().lean();
  cache.clear();
  for (const e of entries) {
    const orgKey = String(e.org_id);
    if (!cache.has(orgKey)) cache.set(orgKey, []);
    cache.get(orgKey)!.push({ hostname: e.hostname, is_wildcard: e.is_wildcard });
  }
}

export async function initAllowlistCache(): Promise<void> {
  await reload();
  console.log(`[cache] Host allowlist loaded: ${[...cache.values()].flat().length} entries`);

  try {
    const cs = HostAllowlist.watch([], { fullDocument: "updateLookup" });
    cs.on("change", async () => { await reload(); });
    cs.on("error", () => {});
  } catch {
    console.info("[cache] Allowlist change stream unavailable (standalone MongoDB).");
  }
}

export async function refreshAllowlistCache(): Promise<void> {
  await reload();
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
    const domain = entry.hostname.slice(2); // strip "*."
    return hostname === domain || hostname.endsWith("." + domain);
  }
  return hostname === entry.hostname;
}

/**
 * Check whether a URL's hostname is allowed for the given organization.
 *
 * Resolution order:
 *  1. If the URL contains {{VAR}} template syntax → allow (runtime will re-check
 *     after env var resolution with the actual hostname).
 *  2. DB host_allowlist for the org.
 *  3. If the DB list is empty → fall back to UPSTREAM_HOST_ALLOWLIST env var
 *     (deprecated bootstrap path, used only on fresh installs before any DB
 *     entries have been added).
 */
export function isHostAllowedForOrg(url: string, orgId: string): boolean {
  // Template URL — skip check, runtime resolves and re-checks
  if (url.includes("{{")) return true;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  const orgEntries = cache.get(orgId) ?? [];

  if (orgEntries.length > 0) {
    const matched = orgEntries.some(e => matchesEntry(hostname, e));
    if (!matched) return false;
    // Even if allowlisted, block plain private ranges unless explicitly added
    // (host.docker.internal etc. must be explicitly in the DB list)
    return true;
  }

  // DB list empty — fall back to env var (deprecated bootstrap)
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
  if (config.upstream.blockPrivateRanges && isPrivate(hostname)) {
    return envList.includes(hostname);
  }
  return true;
}

export function getOrgAllowlist(orgId: string): AllowlistEntry[] {
  return cache.get(orgId) ?? [];
}
