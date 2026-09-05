import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { cors_origins } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

export const corsOriginRepo = {
  list(db: DrizzleDb) {
    return db.select().from(cors_origins).all();
  },

  findById(db: DrizzleDb, id: string) {
    return db.select().from(cors_origins).where(eq(cors_origins.id, id)).get() ?? null;
  },

  create(db: DrizzleDb, input: { origin: string; description?: string; created_by?: string | null }) {
    const id = randomUUID();
    db.insert(cors_origins).values({
      id,
      origin:      input.origin,
      description: input.description ?? "",
      created_by:  input.created_by ?? null,
      created_at:  now(),
    }).run();
    return db.select().from(cors_origins).where(eq(cors_origins.id, id)).get()!;
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(cors_origins).where(eq(cors_origins.id, id)).run();
  },
};
