import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { apps } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type SerializedApp = {
  id: string; name: string; base_path: string; description: string | null;
  status: string; deprecated_at: string | null; auth_required: boolean;
  mode: string; app_env: any[]; allowed_provider_ids: string[];
  created_by: string | null; created_at: string; updated_at: string;
};

export type CreateAppInput = {
  name: string;
  base_path: string;
  description?: string;
  status?: string;
  auth_required?: boolean;
  mode?: string;
  app_env?: unknown[];
  allowed_provider_ids?: string[];
  created_by?: string;
};

export type UpdateAppInput = Partial<Omit<CreateAppInput, "base_path"> & {
  deprecated_at: string | null;
  status: string;
}>;

const now = () => new Date().toISOString();

function serialize(row: typeof apps.$inferSelect) {
  return {
    ...row,
    app_env:              JSON.parse(row.app_env ?? "[]"),
    allowed_provider_ids: JSON.parse(row.allowed_provider_ids ?? "[]"),
    auth_required:        Boolean(row.auth_required),
  };
}

export const appRepo = {
  create(db: DrizzleDb, input: CreateAppInput) {
    const id = randomUUID();
    const t = now();
    db.insert(apps).values({
      id,
      name: input.name.trim(),
      base_path: input.base_path.trim(),
      description: input.description ?? "",
      status: input.status ?? "draft",
      auth_required: input.auth_required ?? true,
      mode: input.mode ?? "prod",
      app_env: JSON.stringify(input.app_env ?? []),
      allowed_provider_ids: JSON.stringify(input.allowed_provider_ids ?? []),
      created_by: input.created_by ?? null,
      created_at: t,
      updated_at: t,
    }).run();
    const row = db.select().from(apps).where(eq(apps.id, id)).get()!;
    return serialize(row);
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(apps).where(eq(apps.id, id)).get();
    return row ? serialize(row) : null;
  },

  findByBasePath(db: DrizzleDb, base_path: string) {
    const row = db.select().from(apps).where(eq(apps.base_path, base_path)).get();
    return row ? serialize(row) : null;
  },

  list(db: DrizzleDb) {
    return db.select().from(apps).all().map(serialize);
  },

  update(db: DrizzleDb, id: string, input: UpdateAppInput) {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name        !== undefined) patch["name"]        = input.name.trim();
    if (input.description !== undefined) patch["description"] = input.description;
    if (input.status      !== undefined) patch["status"]      = input.status;
    if (input.mode        !== undefined) patch["mode"]        = input.mode;
    if (input.auth_required !== undefined) patch["auth_required"] = input.auth_required;
    if (input.deprecated_at !== undefined) patch["deprecated_at"] = input.deprecated_at;
    if (input.app_env     !== undefined) patch["app_env"]     = JSON.stringify(input.app_env);
    if (input.allowed_provider_ids !== undefined) patch["allowed_provider_ids"] = JSON.stringify(input.allowed_provider_ids);
    db.update(apps).set(patch).where(eq(apps.id, id)).run();
    return appRepo.findById(db, id);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(apps).where(eq(apps.id, id)).run();
  },
};
