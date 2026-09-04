import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { secrets } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type CreateSecretInput = {
  name: string;
  description?: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  created_by?: string;
};

const now = () => new Date().toISOString();

// Fields returned in list — no ciphertext exposed
const SAFE_FIELDS = {
  id: secrets.id, name: secrets.name, description: secrets.description,
  created_by: secrets.created_by, rotated_at: secrets.rotated_at,
  last_used_at: secrets.last_used_at, created_at: secrets.created_at,
};

function withId<T extends { id: string }>(row: T) { return { ...row, _id: row.id }; }

export const secretRepo = {
  create(db: DrizzleDb, input: CreateSecretInput) {
    const id = randomUUID();
    db.insert(secrets).values({
      id,
      name: input.name.trim(),
      description: input.description ?? "",
      ciphertext: input.ciphertext,
      iv: input.iv,
      auth_tag: input.auth_tag,
      created_by: input.created_by ?? null,
      created_at: now(),
    }).run();
    return withId(db.select().from(secrets).where(eq(secrets.id, id)).get()!);
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(secrets).where(eq(secrets.id, id)).get();
    return row ? withId(row) : null;
  },

  findByName(db: DrizzleDb, name: string) {
    const row = db.select().from(secrets).where(eq(secrets.name, name.trim())).get();
    return row ? withId(row) : null;
  },

  list(db: DrizzleDb) {
    return db.select(SAFE_FIELDS).from(secrets).all().map(r => ({ ...r, _id: r.id }));
  },

  rotate(db: DrizzleDb, id: string, data: { ciphertext: string; iv: string; auth_tag: string }) {
    db.update(secrets).set({ ...data, rotated_at: now() }).where(eq(secrets.id, id)).run();
  },

  touchLastUsed(db: DrizzleDb, id: string) {
    db.update(secrets).set({ last_used_at: now() }).where(eq(secrets.id, id)).run();
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(secrets).where(eq(secrets.id, id)).run();
  },
};
