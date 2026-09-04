import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { version_history } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function serialize(row: typeof version_history.$inferSelect) {
  return {
    ...row,
    _id:        row.id,
    changed_by: JSON.parse(row.changed_by ?? "{}"),
    snapshot:   JSON.parse(row.snapshot   ?? "{}"),
  };
}

export const versionHistoryRepo = {
  create(db: DrizzleDb, input: {
    app_id: string;
    change_type: string;
    changed_by: { user_id: string | null; username: string };
    description?: string;
    snapshot: { app: unknown; endpoints: unknown[] };
  }) {
    const id = randomUUID();
    db.insert(version_history).values({
      id,
      app_id:      input.app_id,
      change_type: input.change_type,
      changed_by:  JSON.stringify(input.changed_by),
      description: input.description ?? "",
      snapshot:    JSON.stringify(input.snapshot),
      created_at:  now(),
    }).run();
    return serialize(db.select().from(version_history).where(eq(version_history.id, id)).get()!);
  },

  findByAppId(db: DrizzleDb, app_id: string) {
    return db.select().from(version_history)
      .where(eq(version_history.app_id, app_id))
      .orderBy(desc(version_history.created_at))
      .all()
      .map(serialize);
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(version_history).where(eq(version_history.id, id)).get();
    return row ? serialize(row) : null;
  },

  deleteByAppId(db: DrizzleDb, app_id: string) {
    db.delete(version_history).where(eq(version_history.app_id, app_id)).run();
  },
};
