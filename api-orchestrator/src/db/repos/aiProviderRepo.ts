import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ai_providers } from "../schema.js";
import type { DrizzleDb } from "./types.js";
import { secretRepo } from "./secretRepo.js";

const now = () => new Date().toISOString();

// Fields safe to expose — key material never leaves the server
const SAFE_FIELDS = {
  id:         ai_providers.id,
  name:       ai_providers.name,
  base_url:   ai_providers.base_url,
  model:      ai_providers.model,
  secret_id:  ai_providers.secret_id,
  is_active:  ai_providers.is_active,
  created_by: ai_providers.created_by,
  created_at: ai_providers.created_at,
  updated_at: ai_providers.updated_at,
};

function toSafe(db: DrizzleDb, row: typeof ai_providers.$inferSelect) {
  const secretName = row.secret_id ? (secretRepo.findById(db, row.secret_id)?.name ?? null) : null;
  return {
    id: row.id, _id: row.id,
    name: row.name, base_url: row.base_url, model: row.model,
    secret_id: row.secret_id ?? null,
    secret_name: secretName,
    is_active: Boolean(row.is_active),
    created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export type CreateAiProviderInput = {
  name: string;
  base_url: string;
  model: string;
  /** Required — reference to a Secrets-store entry. Keys are never accepted as plain values. */
  secret_id: string;
  is_active?: boolean;
  created_by?: string;
};

export type UpdateAiProviderInput = Partial<CreateAiProviderInput> & {
  secret_id?: string;
};

function requireVaultSecret(db: DrizzleDb, secretId: string) {
  const secret = secretRepo.findById(db, secretId);
  if (!secret) throw new Error(`Secret '${secretId}' not found in vault`);
  return secret;
}

export const aiProviderRepo = {
  create(db: DrizzleDb, input: CreateAiProviderInput) {
    const id = randomUUID();
    const t = now();
    const secret = requireVaultSecret(db, input.secret_id);

    db.insert(ai_providers).values({
      id,
      name:       input.name.trim(),
      base_url:   input.base_url.trim().replace(/\/$/, ""),
      model:      input.model.trim(),
      secret_id:  secret.id,
      is_active:  input.is_active ?? true,
      created_by: input.created_by ?? null,
      created_at: t,
      updated_at: t,
    }).run();
    return this.findByIdSafe(db, id)!;
  },

  // safe — key material never leaves the server
  findByIdSafe(db: DrizzleDb, id: string) {
    const row = db.select(SAFE_FIELDS).from(ai_providers).where(eq(ai_providers.id, id)).get();
    return row ? toSafe(db, row as typeof ai_providers.$inferSelect) : null;
  },

  listSafe(db: DrizzleDb) {
    return db.select(SAFE_FIELDS).from(ai_providers).all().map(row => toSafe(db, row));
  },

  // Full row — INTERNAL ONLY (agent key resolution at call time)
  getFullRow(db: DrizzleDb, id: string) {
    return db.select().from(ai_providers).where(eq(ai_providers.id, id)).get() ?? null;
  },

  update(db: DrizzleDb, id: string, input: UpdateAiProviderInput) {
    const existing = db.select().from(ai_providers).where(eq(ai_providers.id, id)).get();
    if (!existing) return null;

    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name      !== undefined) patch["name"]      = input.name.trim();
    if (input.base_url  !== undefined) patch["base_url"]  = input.base_url.trim().replace(/\/$/, "");
    if (input.model     !== undefined) patch["model"]     = input.model.trim();
    if (input.is_active !== undefined) patch["is_active"] = input.is_active;
    if (input.secret_id !== undefined) patch["secret_id"] = requireVaultSecret(db, input.secret_id).id;

    db.update(ai_providers).set(patch).where(eq(ai_providers.id, id)).run();
    return this.findByIdSafe(db, id);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(ai_providers).where(eq(ai_providers.id, id)).run();
  },
};
