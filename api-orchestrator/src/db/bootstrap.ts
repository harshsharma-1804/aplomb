import { getDb } from "./client.js";
import { organizationRepo } from "./repos/organizationRepo.js";
import { userRepo } from "./repos/userRepo.js";
import { hostAllowlistRepo } from "./repos/hostAllowlistRepo.js";
import { aiProviderRepo } from "./repos/aiProviderRepo.js";
import { config } from "../config/appConfig.js";
import { hash as argon2Hash } from "@node-rs/argon2";

export async function bootstrapOrganization(): Promise<void> {
  const db = getDb();
  const orgName = process.env["ORG_NAME"] ?? "Default Organization";
  const orgSlug = process.env["ORG_SLUG"] ?? "default";

  const existing = organizationRepo.get(db);
  if (existing) return;

  organizationRepo.upsert(db, { name: orgName, slug: orgSlug });
  console.log(`[bootstrap] Organization created: "${orgName}" (slug: ${orgSlug})`);

  // Seed host allowlist from env var on first boot
  const envHosts = config.upstream.hostAllowlist;
  if (envHosts.length > 0) {
    for (const h of envHosts) {
      try {
        hostAllowlistRepo.create(db, {
          hostname: h,
          description: "Seeded from UPSTREAM_HOST_ALLOWLIST env var",
          is_wildcard: h.startsWith("*."),
        });
      } catch {
        // duplicate — already exists, skip
      }
    }
    console.log(`[bootstrap] Seeded ${envHosts.length} host allowlist entries from env var`);
  }
}

export function bootstrapBuiltinAiProvider(): void {
  if (!config.ai.builtinProvider.enabled) return;
  const db = getDb();
  const bp = config.ai.builtinProvider;

  // Idempotent — skip if already seeded (check by name)
  const existing = aiProviderRepo.listSafe(db).find(p => p.name === bp.name);
  if (existing) return;

  aiProviderRepo.create(db, {
    name:       bp.name,
    base_url:   bp.baseUrl,
    model:      bp.model,
    secret_id:  null,   // local model — no API key
    is_active:  true,
    created_by: "system",
  });
  console.log(`[bootstrap] Built-in AI provider seeded: ${bp.name} @ ${bp.baseUrl} (model: ${bp.model})`);
}

export async function bootstrapAdmin(): Promise<void> {
  const db = getDb();
  const existing = userRepo.list(db);
  if (existing.length > 0) return;

  const username = config.auth.bootstrapAdminUsername;
  const password = config.auth.bootstrapAdminPassword;

  if (password.length < config.auth.minPasswordLength) {
    console.warn(`[auth] BOOTSTRAP_ADMIN_PASSWORD is shorter than ${config.auth.minPasswordLength} characters`);
  }

  const password_hash = await argon2Hash(password);
  userRepo.create(db, {
    username,
    email: `${username}@localhost`,
    password_hash,
    role: "admin",
    must_change_password: true,
  });
  console.log(`[bootstrap] Admin user created: ${username}`);
}
