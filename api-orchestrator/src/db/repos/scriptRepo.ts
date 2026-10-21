import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { app_scripts } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

export const scriptRepo = {
  create(db: DrizzleDb, input: { app_id: string; filename: string; language?: string; source?: string; compiled?: string; description?: string; folder?: string | null }) {
    const id = randomUUID();
    const t = now();
    db.insert(app_scripts).values({
      id,
      app_id:      input.app_id,
      filename:    input.filename.trim(),
      language:    input.language ?? "javascript",
      source:      input.source ?? "",
      compiled:    input.compiled ?? null,
      description: input.description ?? "",
      folder:      input.folder ?? null,
      created_at:  t,
      updated_at:  t,
    }).run();
    const row = db.select().from(app_scripts).where(eq(app_scripts.id, id)).get()!;
    return { ...row, _id: row.id };
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(app_scripts).where(eq(app_scripts.id, id)).get();
    return row ? { ...row, _id: row.id } : null;
  },

  findByAppId(db: DrizzleDb, app_id: string) {
    return db.select({
      id: app_scripts.id, app_id: app_scripts.app_id, filename: app_scripts.filename,
      language: app_scripts.language, description: app_scripts.description,
      source: app_scripts.source, folder: app_scripts.folder,
      created_at: app_scripts.created_at, updated_at: app_scripts.updated_at,
    }).from(app_scripts).where(eq(app_scripts.app_id, app_id)).all()
      .map(r => ({ ...r, _id: r.id, folder: r.folder ?? null }));
  },

  update(db: DrizzleDb, id: string, input: { filename?: string; source?: string; compiled?: string; description?: string; language?: string; folder?: string | null }) {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.filename    !== undefined) patch["filename"]    = input.filename;
    if (input.source      !== undefined) patch["source"]      = input.source;
    if (input.compiled    !== undefined) patch["compiled"]    = input.compiled;
    if (input.description !== undefined) patch["description"] = input.description;
    if (input.language    !== undefined) patch["language"]    = input.language;
    if (input.folder      !== undefined) patch["folder"]      = input.folder ?? null;
    db.update(app_scripts).set(patch).where(eq(app_scripts.id, id)).run();
    const row = db.select().from(app_scripts).where(eq(app_scripts.id, id)).get()!;
    return { ...row, _id: row.id };
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(app_scripts).where(eq(app_scripts.id, id)).run();
  },

  deleteByAppId(db: DrizzleDb, app_id: string) {
    db.delete(app_scripts).where(eq(app_scripts.app_id, app_id)).run();
  },
};
