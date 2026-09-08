import { eq } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ai_bots, ai_providers } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function withId<T extends { id: string }>(row: T) { return { ...row, _id: row.id }; }

export type SerializedBot = {
  id: string; _id: string; name: string; is_active: boolean;
  allowed_app_ids: string[];
  allowed_provider_ids: string[];
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
      name:         input.name.trim(),
      api_key_hash,
      is_active:    true,
      allowed_app_ids:      "[]",
      allowed_provider_ids: "[]",
      created_by:   input.created_by ?? null,
      created_at:   now(),
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
    const patch: Record<string, unknown> = {};
    if (input.allowed_app_ids      !== undefined) patch["allowed_app_ids"]      = JSON.stringify(input.allowed_app_ids);
    if (input.allowed_provider_ids !== undefined) patch["allowed_provider_ids"] = JSON.stringify(input.allowed_provider_ids);
    if (Object.keys(patch).length === 0) return this.findById(db, id);
    db.update(ai_bots).set(patch).where(eq(ai_bots.id, id)).run();
    return this.findById(db, id);
  },

  // Verifies an X-Bot-Key value; returns the serialized bot (with bindings) or null.
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

  // Full row incl. encrypted material — used by the agent for key decryption.
  getActiveProviderFull(db: DrizzleDb, allowedProviderIds: string[]) {
    if (!allowedProviderIds.length) return null;
    const candidates = db.select().from(ai_providers).all()
      .filter(p => p.is_active && allowedProviderIds.includes(p.id));
    // Resolve in the admin-assigned order; skip deactivated ones
    for (const pid of allowedProviderIds) {
      const found = candidates.find(p => p.id === pid);
      if (found) return found;
    }
    return null;
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean) {
    db.update(ai_bots).set({ is_active }).where(eq(ai_bots.id, id)).run();
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    return row ? serialize(row) : null;
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(ai_bots).where(eq(ai_bots.id, id)).run();
  },
};
