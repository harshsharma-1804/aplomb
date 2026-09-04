import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { host_allowlist } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function serialize(row: typeof host_allowlist.$inferSelect) {
  return { ...row, _id: row.id, is_wildcard: Boolean(row.is_wildcard) };
}

export const hostAllowlistRepo = {
  create(db: DrizzleDb, input: { hostname: string; description?: string; is_wildcard?: boolean; created_by?: string }) {
    const id = randomUUID();
    db.insert(host_allowlist).values({
      id,
      hostname:    input.hostname.trim().toLowerCase(),
      description: input.description ?? "",
      is_wildcard: input.is_wildcard ?? input.hostname.startsWith("*."),
      created_by:  input.created_by ?? null,
      created_at:  now(),
    }).run();
    return serialize(db.select().from(host_allowlist).where(eq(host_allowlist.id, id)).get()!);
  },

  list(db: DrizzleDb) {
    return db.select().from(host_allowlist).all().map(serialize);
  },

  listHostnames(db: DrizzleDb): string[] {
    return db.select({ hostname: host_allowlist.hostname }).from(host_allowlist).all().map(r => r.hostname);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(host_allowlist).where(eq(host_allowlist.id, id)).run();
  },
};
