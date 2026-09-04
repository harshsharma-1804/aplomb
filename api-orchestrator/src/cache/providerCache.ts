import { getDb } from "../db/client.js";
import { identityProviderRepo } from "../db/repos/identityProviderRepo.js";

export type CachedProvider = {
  id: string; name: string; type: string; issuer: string; jwks_uri: string | null;
  audience: string[]; algorithms: string[];
  claim_mappings: { subject: string; email: string; roles: string };
  clock_tolerance_sec: number; is_active: boolean;
  created_by: string | null; created_at: string; updated_at: string;
};

const byIssuer = new Map<string, CachedProvider>();
const byId     = new Map<string, CachedProvider>();
let pollInterval: ReturnType<typeof setInterval> | null = null;

function reload(): void {
  const providers = identityProviderRepo.listActive(getDb()) as CachedProvider[];
  byIssuer.clear(); byId.clear();
  for (const p of providers) { byIssuer.set(p.issuer, p); byId.set(p.id, p); }
}

export function initProviderCache(): void {
  reload();
  console.log(`[cache] Provider cache loaded: ${byIssuer.size} providers`);
  pollInterval = setInterval(() => { try { reload(); } catch {} }, 30_000);
  pollInterval.unref();
}

export function refreshProviderCache(): void { reload(); }

export function getProviderByIssuer(issuer: string): CachedProvider | null {
  return byIssuer.get(issuer) ?? null;
}

export function getProviderById(id: string): CachedProvider | null {
  return byId.get(id) ?? null;
}

export function getAllProviders(): CachedProvider[] {
  return [...byIssuer.values()];
}

export function stopProviderCachePolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}
