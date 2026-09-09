import { eq, ne } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ai_bots, ai_providers } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function withId<T extends { id: string }>(row: T) { return { ...row, _id: row.id }; }

export interface BotLimits {
  max_tool_calls?: number;
  max_history_messages?: number;
  timeout_ms?: number;
}

export type SerializedBot = {
  id: string; _id: string; name: string; is_active: boolean;
  allowed_app_ids: string[];
  allowed_provider_ids: string[];
  rules: string[];
  limits: BotLimits;
  persona: string;
  last_used_at: string | null;
  created_by: string | null;
  created_at: string;
};

function serialize(row: typeof ai_bots.$inferSelect): SerializedBot {
  return {
    ...row,
    _id: row.id,
    allowed_app_ids:      JSON.parse(row.allowed_app_ids ?? "[]"),
    allowed_provider_ids: JSON.parse(row.allowed_provider_ids ?? "[]"),
    rules:                JSON.parse(row.rules ?? "[]"),
    limits:               JSON.parse(row.limits ?? "{}"),
    persona:              row.persona ?? "",
  };
}

export const aiBotRepo = {
  // Returns the plaintext key ONCE — it is never stored or retrievable afterwards.
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

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    return row ? serialize(row) : null;
  },

  updateBindings(db: DrizzleDb, id: string, input: { allowed_app_ids?: string[]; allowed_provider_ids?: string[] }) {
    // App → Bot uniqueness: each app can only be assigned to one bot.
    // A bot can still have many apps, but no two bots can share the same app.
    if (input.allowed_app_ids !== undefined) {
      const otherBots = db.select().from(ai_bots).where(ne(ai_bots.id, id)).all();
      for (const appId of input.allowed_app_ids) {
        const conflict = otherBots.find(b =>
          (JSON.parse(b.allowed_app_ids ?? "[]") as string[]).includes(appId)
        );
        if (conflict) {
          throw Object.assign(
            new Error(`App "${appId}" is already assigned to bot "${conflict.name}" — remove it there first`),
            { code: "APP_ALREADY_ASSIGNED" }
          );
        }
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.allowed_app_ids      !== undefined) patch["allowed_app_ids"]      = JSON.stringify(input.allowed_app_ids);
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
    const clean: BotLimits = {};
    if (limits.max_tool_calls        != null) clean.max_tool_calls        = Math.max(1, Math.min(limits.max_tool_calls, 20));
    if (limits.max_history_messages  != null) clean.max_history_messages  = Math.max(1, Math.min(limits.max_history_messages, 100));
    if (limits.timeout_ms            != null) clean.timeout_ms            = Math.max(5000, Math.min(limits.timeout_ms, 120_000));
    db.update(ai_bots).set({ limits: JSON.stringify(clean) }).where(eq(ai_bots.id, id)).run();
    return this.findById(db, id);
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean) {
    db.update(ai_bots).set({ is_active }).where(eq(ai_bots.id, id)).run();
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    return row ? serialize(row) : null;
  },

  // Verifies an X-Bot-Key value; returns the serialized bot or null.
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

  // Resolves the first active provider in the bot's ordered list.
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
