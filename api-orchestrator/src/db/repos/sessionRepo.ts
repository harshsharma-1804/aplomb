import { eq, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import { sessions } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type CreateSessionInput = {
  user_id: string;
  token_hash: string;
  expires_at: string;
  ip?: string;
  user_agent?: string;
};

const now = () => new Date().toISOString();

export const sessionRepo = {
  create(db: DrizzleDb, input: CreateSessionInput) {
    const id = randomUUID();
    db.insert(sessions).values({
      id,
      user_id: input.user_id,
      token_hash: input.token_hash,
      expires_at: input.expires_at,
      ip: input.ip ?? "",
      user_agent: input.user_agent ?? "",
      created_at: now(),
    }).run();
    const row = db.select().from(sessions).where(eq(sessions.id, id)).get()!;
    return { ...row, _id: row.id };
  },

  findByTokenHash(db: DrizzleDb, token_hash: string) {
    const row = db.select().from(sessions).where(eq(sessions.token_hash, token_hash)).get();
    return row ? { ...row, _id: row.id } : null;
  },

  revoke(db: DrizzleDb, id: string) {
    db.update(sessions).set({ revoked_at: now() }).where(eq(sessions.id, id)).run();
  },

  revokeByUserId(db: DrizzleDb, user_id: string) {
    db.update(sessions).set({ revoked_at: now() }).where(eq(sessions.user_id, user_id)).run();
  },

  deleteExpired(db: DrizzleDb) {
    db.delete(sessions).where(lt(sessions.expires_at, now())).run();
  },
};
