import { IdentityProvider, type IIdentityProvider } from "../models/IdentityProvider.js";

const byIssuer = new Map<string, IIdentityProvider>();
const byId = new Map<string, IIdentityProvider>();

async function reload(): Promise<void> {
  const providers = await IdentityProvider.find({ is_active: true }).lean() as unknown as IIdentityProvider[];
  byIssuer.clear();
  byId.clear();
  for (const p of providers) {
    byIssuer.set(p.issuer, p);
    byId.set(String(p._id), p);
  }
}

export async function initProviderCache(): Promise<void> {
  await reload();
  console.log(`[cache] Provider cache loaded: ${byIssuer.size} providers`);

  try {
    const changeStream = IdentityProvider.watch([], { fullDocument: "updateLookup" });
    changeStream.on("change", async () => { await reload(); });
    changeStream.on("error", () => {});
  } catch {
    console.info("[cache] Provider change stream unavailable (standalone MongoDB — cache will not auto-refresh). Use a replica set in production.");
  }
}

export function getProviderByIssuer(issuer: string): IIdentityProvider | null {
  return byIssuer.get(issuer) ?? null;
}

export function getProviderById(id: string): IIdentityProvider | null {
  return byId.get(id) ?? null;
}

export function getAllProviders(): IIdentityProvider[] {
  return [...byIssuer.values()];
}
