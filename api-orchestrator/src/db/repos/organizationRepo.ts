import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { organization } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

export const organizationRepo = {
  get(db: DrizzleDb) {
    const row = db.select().from(organization).get();
    return row ? { ...row, _id: row.id } : null;
  },

  upsert(db: DrizzleDb, input: { name: string; slug: string }) {
    const existing = db.select().from(organization).get();
    if (existing) {
      db.update(organization)
        .set({ name: input.name, slug: input.slug.toLowerCase(), updated_at: now() })
        .where(eq(organization.id, existing.id))
        .run();
      const row = db.select().from(organization).where(eq(organization.id, existing.id)).get()!;
      return { ...row, _id: row.id };
    }
    const id = randomUUID();
    const t = now();
    db.insert(organization).values({ id, name: input.name, slug: input.slug.toLowerCase(), created_at: t, updated_at: t }).run();
    const row = db.select().from(organization).where(eq(organization.id, id)).get()!;
    return { ...row, _id: row.id };
  },

  update(db: DrizzleDb, input: { name?: string; slug?: string }) {
    const existing = db.select().from(organization).get();
    if (!existing) return null;
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name !== undefined) patch["name"] = input.name;
    if (input.slug !== undefined) patch["slug"] = input.slug.toLowerCase();
    db.update(organization).set(patch).where(eq(organization.id, existing.id)).run();
    const row = db.select().from(organization).where(eq(organization.id, existing.id)).get()!;
    return { ...row, _id: row.id };
  },
};
