import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { organization } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

/** Org-level dashboard appearance (theme + palette). */
export interface OrgAppearance {
  theme?:   "light" | "dark" | "system";
  palette?: "current" | "coastal" | "monochrome" | "orchid";
}

function serialize(row: typeof organization.$inferSelect) {
  let appearance: OrgAppearance = {};
  try { appearance = JSON.parse(row.appearance ?? "{}") as OrgAppearance; } catch { /* corrupt row — fall back to {} */ }
  return { ...row, appearance, _id: row.id };
}

export const organizationRepo = {
  get(db: DrizzleDb) {
    const row = db.select().from(organization).get();
    return row ? serialize(row) : null;
  },

  upsert(db: DrizzleDb, input: { name: string; slug: string }) {
    const existing = db.select().from(organization).get();
    if (existing) {
      db.update(organization)
        .set({ name: input.name, slug: input.slug.toLowerCase(), updated_at: now() })
        .where(eq(organization.id, existing.id))
        .run();
      const row = db.select().from(organization).where(eq(organization.id, existing.id)).get()!;
      return serialize(row);
    }
    const id = randomUUID();
    const t = now();
    db.insert(organization).values({ id, name: input.name, slug: input.slug.toLowerCase(), created_at: t, updated_at: t }).run();
    const row = db.select().from(organization).where(eq(organization.id, id)).get()!;
    return serialize(row);
  },

  update(db: DrizzleDb, input: { name?: string; slug?: string; appearance?: OrgAppearance }) {
    const existing = db.select().from(organization).get();
    if (!existing) return null;
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name !== undefined) patch["name"] = input.name;
    if (input.slug !== undefined) patch["slug"] = input.slug.toLowerCase();
    if (input.appearance !== undefined) {
      // Merge over the stored appearance so partial updates don't wipe the other key
      let current: OrgAppearance = {};
      try { current = JSON.parse(existing.appearance ?? "{}") as OrgAppearance; } catch { /* ignore */ }
      patch["appearance"] = JSON.stringify({ ...current, ...input.appearance });
    }
    db.update(organization).set(patch).where(eq(organization.id, existing.id)).run();
    const row = db.select().from(organization).where(eq(organization.id, existing.id)).get()!;
    return serialize(row);
  },
};
