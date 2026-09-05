import { Endpoint, type IEndpoint } from "../models/Endpoint.js";

type CachedEndpoint = ReturnType<typeof Endpoint.hydrate> extends infer T ? any : any;

const cache = new Map<string, any[]>(); // key = "${appId}:${METHOD}"

function cacheKey(appId: string, method: string): string {
  return `${appId}:${method.toUpperCase()}`;
}

async function reloadAll(): Promise<void> {
  const all = await Endpoint.find().lean();
  cache.clear();
  for (const ep of all) {
    const key = cacheKey(String(ep.app_id), ep.method);
    if (!cache.has(key)) cache.set(key, []);
    cache.get(key)!.push(ep);
  }
}

export async function initEndpointCache(): Promise<void> {
  await reloadAll();
  const total = [...cache.values()].reduce((s, v) => s + v.length, 0);
  console.log(`[cache] Endpoint cache loaded: ${total} endpoints across ${cache.size} app+method buckets`);

  try {
    const changeStream = Endpoint.watch([], { fullDocument: "updateLookup" });
    changeStream.on("change", async () => {
      await reloadAll();
    });
    changeStream.on("error", () => {});
  } catch {
    console.info("[cache] Endpoint change stream unavailable — explicit invalidation only.");
  }
}

/**
 * Return cached endpoints for a given app + HTTP method.
 * O(1) Map lookup — no DB round-trip.
 */
export function getEndpointsByAppAndMethod(appId: string, method: string): any[] {
  return cache.get(cacheKey(appId, method)) ?? [];
}

/**
 * Invalidate all cached entries for a given app.
 * Called from endpoints.routes.ts after any create / update / delete.
 */
export function invalidateEndpointsForApp(appId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${appId}:`)) cache.delete(key);
  }
}

/**
 * Upsert a single endpoint in the cache after a write —
 * faster than a full reload when only one endpoint changed.
 */
export function upsertEndpointInCache(ep: any): void {
  const key = cacheKey(String(ep.app_id), ep.method);
  if (!cache.has(key)) cache.set(key, []);
  const list = cache.get(key)!;
  const idx = list.findIndex((e: any) => String(e._id) === String(ep._id));
  if (idx >= 0) list[idx] = ep;
  else list.push(ep);
}

/**
 * Remove a single endpoint from the cache after deletion.
 */
export function removeEndpointFromCache(appId: string, method: string, endpointId: string): void {
  const key = cacheKey(appId, method);
  const list = cache.get(key);
  if (list) {
    const filtered = list.filter((e: any) => String(e._id) !== endpointId);
    if (filtered.length > 0) cache.set(key, filtered);
    else cache.delete(key);
  }
}
