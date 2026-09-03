import { App, type IApp } from "../models/App.js";

const cache = new Map<string, IApp>();
let sortedPaths: string[] = [];

function rebuild(apps: IApp[]): void {
  cache.clear();
  for (const app of apps) cache.set(app.base_path, app);
  sortedPaths = [...cache.keys()].sort((a, b) => b.length - a.length);
}

export async function initAppCache(): Promise<void> {
  const apps = await App.find().lean() as unknown as IApp[];
  rebuild(apps);
  console.log(`[cache] App cache loaded: ${apps.length} apps`);

  try {
    const changeStream = App.watch([], { fullDocument: "updateLookup" });
    changeStream.on("change", async () => {
      const fresh = await App.find().lean() as unknown as IApp[];
      rebuild(fresh);
    });
    changeStream.on("error", () => {});
  } catch {
    console.info("[cache] App change stream unavailable (standalone MongoDB — cache will not auto-refresh). Use a replica set in production.");
  }
}

export function getAppByPath(requestPath: string): IApp | null {
  for (const basePath of sortedPaths) {
    if (requestPath === basePath || requestPath.startsWith(basePath + "/")) {
      return cache.get(basePath) ?? null;
    }
  }
  return null;
}

export function getAllApps(): IApp[] {
  return [...cache.values()];
}

export function invalidateApp(basePath: string): void {
  cache.delete(basePath);
  sortedPaths = [...cache.keys()].sort((a, b) => b.length - a.length);
}

/**
 * Reload a single app by its MongoDB _id into the cache.
 * Called immediately after any PUT /apps/:id so status changes
 * take effect on the next request without needing change streams.
 */
export async function refreshApp(appId: string): Promise<void> {
  const app = await App.findById(appId).lean() as unknown as IApp | null;
  if (!app) {
    // App was deleted — remove any entry that referenced it
    for (const [path, cached] of cache.entries()) {
      if (String((cached as any)._id) === appId) {
        cache.delete(path);
        break;
      }
    }
  } else {
    // Remove old entry in case base_path changed
    for (const [path, cached] of cache.entries()) {
      if (String((cached as any)._id) === appId && path !== app.base_path) {
        cache.delete(path);
        break;
      }
    }
    cache.set(app.base_path, app);
  }
  sortedPaths = [...cache.keys()].sort((a, b) => b.length - a.length);
}
