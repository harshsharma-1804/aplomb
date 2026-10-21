import { getDb } from "../db/client.js";
import { identityProviderRepo } from "../db/repos/identityProviderRepo.js";

export type CachedProvider = {
  id: string; name: string; type: string; issuer: string; jwks_uri: string | null;
  client_id: string | null;
  audience: string[]; algorithms: string[];
  claim_mappings: { subject: string; email: string; roles: string };
  clock_tolerance_sec: number; is_active: boolean;
  created_by: string | null; created_at: string; updated_at: string;
};

// issuer → all active providers for that issuer (multiple clients allowed)
const byIssuer = new Map<string, CachedProvider[]>();
const byId     = new Map<string, CachedProvider>();
let pollInterval: ReturnType<typeof setInterval> | null = null;

function reload(): void {
  const providers = identityProviderRepo.listActive(getDb()) as CachedProvider[];
  byIssuer.clear(); byId.clear();
  for (const p of providers) {
    byId.set(p.id, p);
    const existing = byIssuer.get(p.issuer) ?? [];
    existing.push(p);
    byIssuer.set(p.issuer, existing);
  }
}

export function initProviderCache(): void {
  reload();
  console.log(`[cache] Provider cache loaded: ${byId.size} providers`);
  pollInterval = setInterval(() => { try { reload(); } catch {} }, 30_000);
  pollInterval.unref();
}

export function refreshProviderCache(): void { reload(); }

/** All active providers for this issuer (multiple clients per issuer supported). */
export function getProvidersByIssuer(issuer: string): CachedProvider[] {
  return byIssuer.get(issuer) ?? [];
}

/**
 * Find the single provider for this issuer that matches the token's audience.
 * For bearer-token auth: tries each provider until one's audience list matches
 * the token's `aud` claim, or the provider has no audience restriction.
 * Falls back to the first provider for the issuer when no audience is configured
 * (single-client legacy behaviour).
 */
export function getProviderByIssuer(issuer: string, tokenAudience?: string | string[]): CachedProvider | null {
  const providers = byIssuer.get(issuer);
  if (!providers || providers.length === 0) return null;
  if (providers.length === 1) return providers[0]!;

  // Multiple clients for the same issuer — match by audience.
  if (tokenAudience) {
    const audList = Array.isArray(tokenAudience) ? tokenAudience : [tokenAudience];
    for (const p of providers) {
      if (p.audience.length === 0) continue;  // no restriction — skip in multi-client mode
      if (p.audience.some((a) => audList.includes(a))) return p;
    }
    // No audience match — return unrestricted provider if one exists.
    return providers.find((p) => p.audience.length === 0) ?? providers[0]!;
  }

  return providers[0]!;
}

export function getProviderById(id: string): CachedProvider | null {
  return byId.get(id) ?? null;
}

export function getAllProviders(): CachedProvider[] {
  return [...byId.values()];
}

export function stopProviderCachePolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}
