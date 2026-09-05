import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { IdentityProvider } from "../db/schema.js";
import { getAllProviders } from "../cache/providerCache.js";

export interface NormalisedPrincipal {
  sub: string;
  email: string | null;
  roles: string[];
  issuer: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const jwksUriCache = new Map<string, string>();

function getJWKS(provider: IdentityProvider & { jwks_uri: string }): ReturnType<typeof createRemoteJWKSet> {
  const key = provider.id;
  if (jwksCache.has(key)) return jwksCache.get(key)!;
  const jwks = createRemoteJWKSet(new URL(provider.jwks_uri), { cacheMaxAge: 15 * 60 * 1000 });
  jwksCache.set(key, jwks);
  return jwks;
}

export function invalidateProviderCache(providerId: string): void {
  jwksCache.delete(providerId);
}

/**
 * Pre-warm the JWKS cache for all active providers at startup.
 * Eliminates the ~900ms cold-start penalty on the first real user request.
 * Called after initProviderCache() in index.ts.
 */
export async function warmJwksCache(): Promise<void> {
  const providers = getAllProviders();
  if (providers.length === 0) {
    console.log("[jwks] No active providers to pre-warm");
    return;
  }
  await Promise.all(providers.map(async (p: any) => {
    try {
      let uri = p.jwks_uri;
      if (!uri) uri = await discoverJwksUri(p.issuer);
      getJWKS({ ...p, jwks_uri: uri } as IdentityProvider & { jwks_uri: string });
      console.log(`[jwks] Pre-warmed: ${p.issuer}`);
    } catch (e) {
      console.warn(`[jwks] Pre-warm failed for ${p.issuer}:`, (e as Error).message);
    }
  }));
}

export async function discoverJwksUri(issuer: string): Promise<string> {
  if (jwksUriCache.has(issuer)) return jwksUriCache.get(issuer)!;
  const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl);
  if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`);
  const cfg = await res.json() as { jwks_uri?: string };
  if (!cfg.jwks_uri) throw new Error(`No jwks_uri in OIDC discovery for ${issuer}`);
  jwksUriCache.set(issuer, cfg.jwks_uri);
  return cfg.jwks_uri;
}

export async function validateToken(
  token: string,
  provider: IdentityProvider & { audience: string[]; algorithms: string[]; claim_mappings: { subject: string; email: string; roles: string } }
): Promise<NormalisedPrincipal> {
  let jwksUri = provider.jwks_uri;
  if (!jwksUri) jwksUri = await discoverJwksUri(provider.issuer);

  const jwks = getJWKS({ ...provider, jwks_uri: jwksUri });

  const { payload } = await jwtVerify(token, jwks, {
    issuer: provider.issuer,
    audience: provider.audience.length > 0 ? provider.audience : undefined,
    algorithms: provider.algorithms as any,
    clockTolerance: provider.clock_tolerance_sec,
  });

  const cm = provider.claim_mappings;
  const rawPayload = payload as JWTPayload & Record<string, unknown>;

  return {
    sub:    String(rawPayload[cm.subject] ?? rawPayload["sub"] ?? ""),
    email:  rawPayload[cm.email] ? String(rawPayload[cm.email]) : null,
    roles:  Array.isArray(rawPayload[cm.roles]) ? (rawPayload[cm.roles] as string[]) : [],
    issuer: provider.issuer,
  };
}

export function readIssuerFromToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { iss?: string };
    return payload.iss ?? null;
  } catch {
    return null;
  }
}
