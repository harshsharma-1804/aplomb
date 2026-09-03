import { Organization } from "../models/Organization.js";
import { App } from "../models/App.js";
import { User } from "../models/User.js";
import { Secret } from "../models/Secret.js";
import { IdentityProvider } from "../models/IdentityProvider.js";
import { HostAllowlist } from "../models/HostAllowlist.js";
import { config } from "../config/appConfig.js";
import { hash as argon2Hash } from "@node-rs/argon2";

/**
 * Bootstrap the default organization on first boot.
 * Also migrates any existing documents that have no org_id to belong to it.
 * Idempotent — safe to run on every startup.
 */
export async function bootstrapOrganization(): Promise<string> {
  const orgName = process.env["ORG_NAME"] ?? "Default Organization";
  const orgSlug = process.env["ORG_SLUG"] ?? "default";

  const existingOrg = await Organization.findOne({ slug: orgSlug }).lean();

  const orgDoc = existingOrg ?? await Organization.create({ name: orgName, slug: orgSlug });
  if (!existingOrg) {
    console.log(`[bootstrap] Organization created: "${orgName}" (slug: ${orgSlug})`);
  }

  const orgId = orgDoc._id;

  // Migrate existing documents that have no org_id
  const [apps, users, secrets, providers] = await Promise.all([
    App.countDocuments({ org_id: null }),
    User.countDocuments({ org_id: null }),
    Secret.countDocuments({ org_id: null }),
    IdentityProvider.countDocuments({ org_id: null }),
  ]);

  if (apps + users + secrets + providers > 0) {
    await Promise.all([
      App.updateMany({ org_id: null }, { $set: { org_id: orgId } }),
      User.updateMany({ org_id: null }, { $set: { org_id: orgId } }),
      Secret.updateMany({ org_id: null }, { $set: { org_id: orgId } }),
      IdentityProvider.updateMany({ org_id: null }, { $set: { org_id: orgId } }),
    ]);
    console.log(`[bootstrap] Migrated ${apps} apps, ${users} users, ${secrets} secrets, ${providers} providers → org "${orgName}"`);
  }

  // Seed default host allowlist entries from env var (one-time migration)
  const existingCount = await HostAllowlist.countDocuments({ org_id: orgId });
  if (existingCount === 0) {
    const envHosts = config.upstream.hostAllowlist;
    if (envHosts.length > 0) {
      const entries = envHosts.map(h => ({
        org_id: orgId,
        hostname: h,
        description: "Migrated from UPSTREAM_HOST_ALLOWLIST env var",
        is_wildcard: h.startsWith("*."),
        created_by: null,
      }));
      await HostAllowlist.insertMany(entries, { ordered: false }).catch(() => {});
      console.log(`[bootstrap] Seeded ${entries.length} host allowlist entries from env var`);
    }
  }

  return String(orgId);
}

/**
 * Bootstrap the admin user — same as before but now also sets org_id.
 */
export async function bootstrapAdmin(orgId: string): Promise<void> {
  const count = await User.countDocuments();
  if (count > 0) {
    // Ensure existing admin has org_id
    await User.updateMany({ org_id: null }, { $set: { org_id: orgId } });
    return;
  }

  const username = config.auth.bootstrapAdminUsername;
  const password = config.auth.bootstrapAdminPassword;

  if (password.length < config.auth.minPasswordLength) {
    console.warn(`[auth] BOOTSTRAP_ADMIN_PASSWORD is shorter than ${config.auth.minPasswordLength} characters`);
  }

  const password_hash = await argon2Hash(password);
  await User.create({
    username, email: `${username}@localhost`,
    password_hash, role: "admin",
    must_change_password: true,
    org_id: orgId,
  });
  console.log(`[bootstrap] Admin user created: ${username}`);
}
