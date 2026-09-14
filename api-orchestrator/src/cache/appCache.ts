import { getDb } from "../db/client.js";
import { appRepo, type SessionConfig } from "../db/repos/appRepo.js";

export type CachedApp = {
  id: string; name: string; base_path: string; description: string | null;
  status: string; deprecated_at: string | null; auth_required: boolean;
  mode: string; app_env: any[]; allowed_provider_ids: string[];
  auth_mode: string; session_method: string; session_config: SessionConfig;
  created_by: string | null; created_at: string; updated_at: string;
};

const cache = new Map<string, CachedApp>();
let sortedPaths: string[] = [];
let pollInterval: ReturnType<typeof setInterval> | null = null;

function rebuild(apps: CachedApp[]): void {
  cache.clear();
  for (const app of apps) cache.set(app.base_path, app);
  sortedPaths = [...cache.keys()].sort((a, b) => b.length - a.length);
}

export function initAppCache(): void {
  const db = getDb();
  const apps = appRepo.list(db) as CachedApp[];
  rebuild(apps);
  console.log(`[cache] App cache loaded: ${apps.length} apps`);

  pollInterval = setInterval(() => {
    try { rebuild(appRepo.list(getDb()) as CachedApp[]); } catch {}
  }, 30_000);
  pollInterval.unref();
}

export function getAppByPath(requestPath: string): CachedApp | null {
  for (const basePath of sortedPaths) {
    if (requestPath === basePath || requestPath.startsWith(basePath + "/")) {
      return cache.get(basePath) ?? null;
    }
  }
  return null;
}

export function getAllApps(): CachedApp[] {
  return [...cache.values()];
}

export function refreshApp(appId: string): void {
  const db = getDb();
  const app = appRepo.findById(db, appId) as CachedApp | null;
  if (!app) {
    for (const [path, cached] of cache.entries()) {
      if (cached.id === appId) { cache.delete(path); break; }
    }
  } else {
    for (const [path, cached] of cache.entries()) {
      if (cached.id === appId && path !== app.base_path) { cache.delete(path); break; }
    }
    cache.set(app.base_path, app);
  }
  sortedPaths = [...cache.keys()].sort((a, b) => b.length - a.length);
}

export function stopAppCachePolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}
