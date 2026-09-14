import { eq, ne } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ai_bots, ai_providers } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function withId<T extends { id: string }>(row: T) { return { ...row, _id: row.id }; }

// ── Permission types ──────────────────────────────────────────────────────────

export interface AppPermission {
  read: boolean;
  write: boolean;
}

/** Map of app_id → permissions. Replaces / extends allowed_app_ids. */
export type AppPermissionsMap = Record<string, AppPermission>;

export interface ScopeGuardConfig {
  /** When false (default) the upstream is the authority — no pre-upstream blocking. */
  enabled: boolean;
  /** Tool argument names treated as user identifiers (case-insensitive). */
  id_arg_names: string[];
  /** Optional JS regex — any arg value matching this is also treated as a user ID. */
  id_value_pattern?: string;
  /** Message returned to the LLM when a scope violation is detected. */
  deny_message?: string;
}

export interface BotLimits {
  max_tool_calls?: number;
  max_history_messages?: number;
  timeout_ms?: number;
  // Abuse protection — max /__ai/chat + /mcp requests per minute (0/absent = unlimited)
  rate_limit_per_min?: number;
  // Scope enforcement (intent classification)
  scope_enforcement?: boolean;
  scope_description?: string;
  /**
   * Optional full classification rubric. When set, replaces the entire
   * system message of the classification call (must instruct the model
   * to answer YES or NO). When absent, scope_description is used with
   * the built-in "Domain: ..." wrapper.
   */
  scope_classification_prompt?: string;
  out_of_scope_message?: string;
  scope_context_messages?: number;
  // Hard behaviour controls
  tool_only_mode?: boolean;
  tool_only_refusal?: string;
  topic_blocklist?: string[];
  fallback_message?: string;
  max_response_words?: number;
  // User scope guard (configurable, disabled by default — upstream is the real gate)
  scope_guard?: ScopeGuardConfig;
}

export type SerializedBot = {
  id: string; _id: string; name: string; is_active: boolean;
  allowed_app_ids: string[];          // derived from app_permissions (backward compat)
  allowed_provider_ids: string[];
  app_permissions: AppPermissionsMap;
  rules: string[];
  limits: BotLimits;
  persona: string;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
};

/**
 * Auto-migrate: if app_permissions is empty but allowed_app_ids has entries,
 * promote the existing apps to { read: true, write: true }.
 */
function parsePermissions(row: typeof ai_bots.$inferSelect): AppPermissionsMap {
  const perms: AppPermissionsMap = JSON.parse(row.app_permissions ?? "{}");
  if (Object.keys(perms).length === 0) {
    const ids: string[] = JSON.parse(row.allowed_app_ids ?? "[]");
    for (const id of ids) perms[id] = { read: true, write: true };
  }
  return perms;
}

function serialize(row: typeof ai_bots.$inferSelect): SerializedBot {
  const appPerms = parsePermissions(row);
  // derive allowed_app_ids: apps where at least one permission is true
  const allowedAppIds = Object.entries(appPerms)
    .filter(([, p]) => p.read || p.write)
    .map(([id]) => id);

  return {
    ...row,
    _id: row.id,
    app_permissions:      appPerms,
    allowed_app_ids:      allowedAppIds,
    allowed_provider_ids: JSON.parse(row.allowed_provider_ids ?? "[]"),
    rules:                JSON.parse(row.rules ?? "[]"),
    limits:               JSON.parse(row.limits ?? "{}"),
    persona:              row.persona ?? "",
  };
}

// ── Uniqueness helper ─────────────────────────────────────────────────────────

function checkAppConflicts(db: DrizzleDb, botId: string, appIds: string[]) {
  const otherBots = db.select().from(ai_bots).where(ne(ai_bots.id, botId)).all();
  for (const appId of appIds) {
    const conflict = otherBots.find(b => {
      const perms: AppPermissionsMap = JSON.parse(b.app_permissions ?? "{}");
      if (Object.keys(perms).length) return !!perms[appId];
      // fall back to legacy allowed_app_ids for bots not yet migrated
      return (JSON.parse(b.allowed_app_ids ?? "[]") as string[]).includes(appId);
    });
    if (conflict) {
      throw Object.assign(
        new Error(`App "${appId}" is already assigned to bot "${conflict.name}" — remove it there first`),
        { code: "APP_ALREADY_ASSIGNED" }
      );
    }
  }
}

// ── Repo ──────────────────────────────────────────────────────────────────────

export const aiBotRepo = {
  async create(db: DrizzleDb, input: { name: string; created_by?: string }) {
    const id = randomUUID();
    const apiKey = `obk_${randomBytes(24).toString("base64url")}`;
    const api_key_hash = await argon2Hash(apiKey);
    db.insert(ai_bots).values({
      id,
      name:                 input.name.trim(),
      api_key_hash,
      is_active:            true,
      allowed_app_ids:      "[]",
      allowed_provider_ids: "[]",
      app_permissions:      "{}",
      rules:                "[]",
      limits:               "{}",
      persona:              "",
      created_by:           input.created_by ?? null,
      created_at:           now(),
    }).run();
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get()!;
    return { bot: serialize(row), api_key: apiKey };
  },

  listSafe(db: DrizzleDb) {
    return db.select().from(ai_bots).all().map(serialize);
  },

  /** Bots bound to an app (any permission) — used for session bot_snapshot at login. */
  listBotsForApp(db: DrizzleDb, appId: string) {
    return this.listSafe(db).filter(b => b.allowed_app_ids.includes(appId));
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    return row ? serialize(row) : null;
  },

  // Update app_permissions map (and keep allowed_app_ids in sync for legacy compat)
  updateAppPermissions(db: DrizzleDb, botId: string, perms: AppPermissionsMap) {
    const appIds = Object.entries(perms).filter(([, p]) => p.read || p.write).map(([id]) => id);
    checkAppConflicts(db, botId, appIds);
    const allowedAppIds = JSON.stringify(appIds);
    db.update(ai_bots).set({
      app_permissions: JSON.stringify(perms),
      allowed_app_ids: allowedAppIds,
    }).where(eq(ai_bots.id, botId)).run();
    return this.findById(db, botId);
  },

  // Update a single app's permissions without touching others
  updateOneAppPermission(db: DrizzleDb, botId: string, appId: string, perm: AppPermission) {
    const bot = db.select().from(ai_bots).where(eq(ai_bots.id, botId)).get();
    if (!bot) return null;
    const perms: AppPermissionsMap = parsePermissions(bot);
    // If adding a new app → check conflict
    if (!perms[appId]) checkAppConflicts(db, botId, [appId]);
    if (perm.read || perm.write) {
      perms[appId] = perm;
    } else {
      delete perms[appId];  // neither read nor write = unassign
    }
    return this.updateAppPermissions(db, botId, perms);
  },

  // Legacy bindings update (providers only now; apps go through updateAppPermissions)
  updateBindings(db: DrizzleDb, id: string, input: { allowed_provider_ids?: string[]; app_permissions?: AppPermissionsMap }) {
    if (input.app_permissions !== undefined) {
      return this.updateAppPermissions(db, id, input.app_permissions);
    }
    const patch: Record<string, unknown> = {};
    if (input.allowed_provider_ids !== undefined) patch["allowed_provider_ids"] = JSON.stringify(input.allowed_provider_ids);
    if (!Object.keys(patch).length) return this.findById(db, id);
    db.update(ai_bots).set(patch).where(eq(ai_bots.id, id)).run();
    return this.findById(db, id);
  },

  updateRules(db: DrizzleDb, id: string, rules: string[], persona: string) {
    const clean = rules.map(r => r.trim()).filter(Boolean).slice(0, 20);
    for (const r of clean) {
      if (r.length > 500) throw new Error(`Rule exceeds 500 characters: "${r.slice(0, 60)}…"`);
    }
    db.update(ai_bots).set({ rules: JSON.stringify(clean), persona: persona.slice(0, 2000) })
      .where(eq(ai_bots.id, id)).run();
    return this.findById(db, id);
  },

  updateLimits(db: DrizzleDb, id: string, limits: BotLimits) {
    // Existing bots: merge into existing limits blob (preserve other keys)
    const existing = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    if (!existing) return null;
    const current: BotLimits = JSON.parse(existing.limits ?? "{}");
    const merged: BotLimits = { ...current, ...limits };
    // Clamp numeric fields
    if (merged.max_tool_calls        != null) merged.max_tool_calls        = Math.max(1, Math.min(merged.max_tool_calls, 20));
    if (merged.max_history_messages  != null) merged.max_history_messages  = Math.max(1, Math.min(merged.max_history_messages, 100));
    if (merged.timeout_ms            != null) merged.timeout_ms            = Math.max(5000, Math.min(merged.timeout_ms, 120_000));
    if (merged.max_response_words    != null) merged.max_response_words    = Math.max(10, Math.min(merged.max_response_words, 2000));
    if (merged.scope_context_messages != null) merged.scope_context_messages = Math.max(1, Math.min(merged.scope_context_messages, 10));
    if (merged.rate_limit_per_min    != null) merged.rate_limit_per_min    = Math.max(0, Math.min(merged.rate_limit_per_min, 600));
    db.update(ai_bots).set({ limits: JSON.stringify(merged) }).where(eq(ai_bots.id, id)).run();
    return this.findById(db, id);
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean) {
    db.update(ai_bots).set({ is_active }).where(eq(ai_bots.id, id)).run();
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    return row ? serialize(row) : null;
  },

  async verifyKey(db: DrizzleDb, apiKey: string) {
    const bots = db.select().from(ai_bots).where(eq(ai_bots.is_active, true)).all();
    for (const bot of bots) {
      const ok = await argon2Verify(bot.api_key_hash, apiKey);
      if (ok) {
        db.update(ai_bots).set({ last_used_at: now() }).where(eq(ai_bots.id, bot.id)).run();
        return serialize(bot);
      }
    }
    return null;
  },

  getActiveProviderFull(db: DrizzleDb, allowedProviderIds: string[]) {
    if (!allowedProviderIds.length) return null;
    const candidates = db.select().from(ai_providers).all()
      .filter(p => p.is_active && allowedProviderIds.includes(p.id));
    for (const pid of allowedProviderIds) {
      const found = candidates.find(p => p.id === pid);
      if (found) return found;
    }
    return null;
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(ai_bots).where(eq(ai_bots.id, id)).run();
  },
};
