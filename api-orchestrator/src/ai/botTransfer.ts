import { getDb } from "../db/client.js";
import { appRepo } from "../db/repos/appRepo.js";
import { secretRepo } from "../db/repos/secretRepo.js";
import { aiBotRepo, type SerializedBot, type AppPermission } from "../db/repos/aiBotRepo.js";
import { aiProviderRepo } from "../db/repos/aiProviderRepo.js";

/**
 * Bot transfer format — shared by the standalone bot bundle and the
 * app export bundle. Instance-specific identifiers (bot ids, provider ids,
 * app ids, key material) never travel; references go by NAME / base_path.
 *
 * Bot key material is stored hashed and can NEVER be exported — every import
 * generates a fresh key, returned once to the importer.
 */

export interface ExportedBotAppRef {
  base_path: string;
  name: string;
  permission: AppPermission;
}

export interface ExportedBot {
  name: string;
  is_active: boolean;
  persona: string;
  rules: string[];
  limits: Record<string, unknown>;
  /** Bindings by base_path — resolved against the target instance on import. */
  apps: ExportedBotAppRef[];
  provider_names: string[];
}

export interface ExportedAiProvider {
  name: string;
  base_url: string;
  model: string;
  no_auth: boolean;
  secret_name: string | null;
  is_active: boolean;
}

// ── Export ────────────────────────────────────────────────────────────────────

export function buildBotBundle(db: ReturnType<typeof getDb>, bots: SerializedBot[]): {
  bots: ExportedBot[];
  ai_providers: ExportedAiProvider[];
} {
  const providerIds = new Set<string>();
  const exportedBots: ExportedBot[] = bots.map(b => {
    const apps: ExportedBotAppRef[] = [];
    for (const [appId, permission] of Object.entries(b.app_permissions)) {
      if (!permission.read && !permission.write) continue;
      const app = appRepo.findById(db, appId);
      if (!app) continue; // dangling binding — skip silently
      apps.push({ base_path: app.base_path, name: app.name, permission });
    }
    for (const pid of b.allowed_provider_ids) providerIds.add(String(pid));
    return {
      name: b.name,
      is_active: b.is_active,
      persona: b.persona,
      rules: b.rules,
      limits: b.limits as Record<string, unknown>,
      apps,
      provider_names: b.allowed_provider_ids
        .map(pid => aiProviderRepo.findByIdSafe(db, String(pid))?.name)
        .filter((n): n is string => Boolean(n)),
    };
  });

  const ai_providers: ExportedAiProvider[] = [];
  for (const pid of providerIds) {
    const p = aiProviderRepo.findByIdSafe(db, pid);
    if (!p) continue;
    ai_providers.push({
      name: p.name,
      base_url: p.base_url,
      model: p.model,
      no_auth: p.no_auth,
      secret_name: p.secret_name ?? null,
      is_active: p.is_active,
    });
  }

  return { bots: exportedBots, ai_providers };
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface BotBundleImportResult {
  created: Array<{ name: string; api_key: string }>;
  botIds: string[];
}

/**
 * Import AI providers from a bundle. Matched by NAME against existing
 * providers; created when missing AND their secret exists (matched by secret
 * name). Providers whose secret is missing are skipped with a warning — the
 * gateway never invents keyless providers for upstreams that need auth.
 */
export function importProviders(
  db: ReturnType<typeof getDb>,
  providers: ExportedAiProvider[] | undefined,
  warnings: string[],
  createdBy?: string
): Map<string, string> {
  const nameToId = new Map<string, string>();
  for (const p of providers ?? []) {
    try {
      const existing = aiProviderRepo.listSafe(db).find(x => x.name.toLowerCase() === String(p.name).toLowerCase());
      if (existing) {
        nameToId.set(String(p.name).toLowerCase(), existing.id);
        if (existing.base_url !== p.base_url || existing.model !== p.model) {
          warnings.push(`AI provider '${p.name}' already exists on this instance with a different base_url/model — keeping the existing provider. Verify its settings in Admin → AI Providers.`);
        }
        continue;
      }
      let secretId: string | null = null;
      if (p.secret_name) {
        const secret = secretRepo.findByName(db, String(p.secret_name));
        if (secret) {
          secretId = secret.id;
        } else {
          warnings.push(`AI provider '${p.name}' needs a secret named '${p.secret_name}' (its API key), but no secret with that name exists on this instance. The provider was NOT created — create the secret in Admin → Secrets, then add the provider in Admin → AI Providers, then bind it to the imported bot.`);
          continue;
        }
      }
      const created = aiProviderRepo.create(db, {
        name: String(p.name),
        base_url: String(p.base_url),
        model: String(p.model),
        secret_id: secretId,
        is_active: Boolean(p.is_active),
        created_by: createdBy,
      });
      nameToId.set(String(p.name).toLowerCase(), created.id);
      if (!secretId && !p.no_auth) {
        warnings.push(`AI provider '${p.name}' was created WITHOUT an API key (its secret '${p.secret_name}' does not exist here) — set the key before using it.`);
      }
    } catch (e: any) {
      warnings.push(`AI provider '${p.name}' could not be imported: ${e.message}`);
    }
  }
  return nameToId;
}

/**
 * Import bots from a bundle. App bindings are resolved through
 * resolveAppIdByBasePath (caller decides which apps exist — the app import
 * maps the bundle's base_path to the freshly imported app). One bot per app:
 * an app already owned by another bot yields a warning, not a failure.
 */
export async function importBotBundle(
  db: ReturnType<typeof getDb>,
  bots: ExportedBot[] | undefined,
  providerNameToId: Map<string, string>,
  resolveAppIdByBasePath: (basePath: string) => string | null,
  warnings: string[],
  createdBy?: string
): Promise<BotBundleImportResult> {
  const created: Array<{ name: string; api_key: string }> = [];
  const botIds: string[] = [];

  for (const b of bots ?? []) {
    try {
      // Name collision → suffix like scripts
      const existingNames = new Set(aiBotRepo.listSafe(db).map(x => x.name.toLowerCase()));
      let name = String(b.name);
      let suffix = 2;
      while (existingNames.has(name.toLowerCase())) {
        name = `${b.name}-${suffix}`;
        suffix++;
        if (suffix > 2) warnings.push(`Bot '${b.name}' already exists on this instance — imported as '${name}'. Update the calling frontend's configuration if it referenced the old name.`);
      }

      const { bot, api_key } = await aiBotRepo.create(db, { name, created_by: createdBy });

      // Provider bindings (by name → instance ids)
      const mappedIds = [...new Set(((b.provider_names ?? []) as string[])
        .map((pn: string) => providerNameToId.get(String(pn).toLowerCase()))
        .filter((id): id is string => Boolean(id)))];
      const unmapped = ((b.provider_names ?? []) as string[]).filter((pn: string) => !providerNameToId.has(String(pn).toLowerCase()));
      if (unmapped.length) {
        warnings.push(`Bot '${name}' references AI provider(s) not available on this instance: ${unmapped.join(", ")} — bind a provider manually in the bot's Bindings tab.`);
      }
      if (mappedIds.length || unmapped.length === 0) {
        await aiBotRepo.updateBindings(db, bot.id, { allowed_provider_ids: mappedIds });
      }

      // Behaviour
      await aiBotRepo.updateRules(db, bot.id, Array.isArray(b.rules) ? b.rules : [], String(b.persona ?? ""));
      if (b.limits && typeof b.limits === "object") {
        await aiBotRepo.updateLimits(db, bot.id, b.limits as any);
      }
      if (b.is_active === false) {
        aiBotRepo.setActive(db, bot.id, false);
      }

      // App bindings by base_path
      for (const ref of (b.apps ?? []) as ExportedBotAppRef[]) {
        if (!ref.permission?.read && !ref.permission?.write) continue;
        const appId = resolveAppIdByBasePath(String(ref.base_path));
        if (!appId) {
          warnings.push(`Bot '${name}' was bound to app '${ref.name}' (${ref.base_path}) which does not exist on this instance — import/create the app, then bind the bot in Bots → Bindings.`);
          continue;
        }
        try {
          await aiBotRepo.updateOneAppPermission(db, bot.id, appId, ref.permission ?? { read: true, write: true });
        } catch (e: any) {
          if (e.code === "APP_ALREADY_ASSIGNED") {
            warnings.push(`Bot '${name}' could not be bound to app '${ref.base_path}' — this instance already has a bot for that app. Bind it manually in Bots → Bindings (after unassigning the other bot).`);
          } else {
            throw e;
          }
        }
      }

      created.push({ name, api_key });
      botIds.push(bot.id);
    } catch (e: any) {
      warnings.push(`Bot '${b.name}' could not be imported: ${e.message}`);
    }
  }

  if (created.length > 0) {
    warnings.push("IMPORTANT: new bot keys were generated during import (bot keys are stored hashed and can never be exported). Copy them from the result screen NOW — they are shown only once. Update the calling frontend to use the new X-Bot-Key.");
  }

  return { created, botIds };
}
