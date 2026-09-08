import { eq } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { ai_bots } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function withId<T extends { id: string }>(row: T) { return { ...row, _id: row.id }; }

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
      created_by:   input.created_by ?? null,
      created_at:   now(),
    }).run();
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get()!;
    return { bot: withId(row), api_key: apiKey };
  },

  listSafe(db: DrizzleDb) {
    return db.select({
      id: ai_bots.id, name: ai_bots.name, is_active: ai_bots.is_active,
      last_used_at: ai_bots.last_used_at, created_by: ai_bots.created_by, created_at: ai_bots.created_at,
    }).from(ai_bots).all().map(r => withId(r));
  },

  // Verifies an X-Bot-Key value; returns the bot row (full) or null.
  async verifyKey(db: DrizzleDb, apiKey: string) {
    const bots = db.select().from(ai_bots).where(eq(ai_bots.is_active, true)).all();
    for (const bot of bots) {
      const ok = await argon2Verify(bot.api_key_hash, apiKey);
      if (ok) {
        db.update(ai_bots).set({ last_used_at: now() }).where(eq(ai_bots.id, bot.id)).run();
        return withId(bot);
      }
    }
    return null;
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean) {
    db.update(ai_bots).set({ is_active }).where(eq(ai_bots.id, id)).run();
    const row = db.select().from(ai_bots).where(eq(ai_bots.id, id)).get();
    return row ? withId(row) : null;
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(ai_bots).where(eq(ai_bots.id, id)).run();
  },
};
