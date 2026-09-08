import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ai_providers } from "../schema.js";
import type { DrizzleDb } from "./types.js";
import { encryptSecret } from "../../secrets/resolver.js";

const now = () => new Date().toISOString();

function withId<T extends { id: string }>(row: T) { return { ...row, _id: row.id }; }

export type CreateAiProviderInput = {
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  is_active?: boolean;
  created_by?: string;
};

export type UpdateAiProviderInput = Partial<Omit<CreateAiProviderInput, "api_key">> & {
  api_key?: string;
};

export const aiProviderRepo = {
  create(db: DrizzleDb, input: CreateAiProviderInput) {
    const id = randomUUID();
    const t = now();
    const enc = encryptSecret(input.api_key);
    db.insert(ai_providers).values({
      id,
      name:       input.name.trim(),
      base_url:   input.base_url.trim().replace(/\/$/, ""),
      model:      input.model.trim(),
      ciphertext: enc.ciphertext,
      iv:         enc.iv,
      auth_tag:   enc.auth_tag,
      is_active:  input.is_active ?? true,
      created_by: input.created_by ?? null,
      created_at: t,
      updated_at: t,
    }).run();
    return withId(db.select().from(ai_providers).where(eq(ai_providers.id, id)).get()!);
  },

  // never exposes the encrypted material
  _safe(db: DrizzleDb, id: string) {
    const row = db.select({
      id: ai_providers.id, name: ai_providers.name, base_url: ai_providers.base_url,
      model: ai_providers.model, is_active: ai_providers.is_active,
      created_by: ai_providers.created_by, created_at: ai_providers.created_at, updated_at: ai_providers.updated_at,
    }).from(ai_providers).where(eq(ai_providers.id, id)).get();
    return row ? withId(row) : null;
  },

  findByIdSafe(db: DrizzleDb, id: string) {
    return this._safe(db, id);
  },

  listSafe(db: DrizzleDb) {
    return db.select({
      id: ai_providers.id, name: ai_providers.name, base_url: ai_providers.base_url,
      model: ai_providers.model, is_active: ai_providers.is_active,
      created_by: ai_providers.created_by, created_at: ai_providers.created_at, updated_at: ai_providers.updated_at,
    }).from(ai_providers).all().map(r => withId(r));
  },

  // internal — full row incl. encrypted material, for decryption at call time
  getActiveFull(db: DrizzleDb) {
    return db.select().from(ai_providers).where(eq(ai_providers.is_active, true)).get() ?? null;
  },

  update(db: DrizzleDb, id: string, input: UpdateAiProviderInput) {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name      !== undefined) patch["name"]      = input.name.trim();
    if (input.base_url  !== undefined) patch["base_url"]  = input.base_url.trim().replace(/\/$/, "");
    if (input.model     !== undefined) patch["model"]     = input.model.trim();
    if (input.is_active !== undefined) patch["is_active"] = input.is_active;
    if (input.api_key   !== undefined) {
      const enc = encryptSecret(input.api_key);
      patch["ciphertext"] = enc.ciphertext;
      patch["iv"]         = enc.iv;
      patch["auth_tag"]   = enc.auth_tag;
    }
    db.update(ai_providers).set(patch).where(eq(ai_providers.id, id)).run();
    return this._safe(db, id);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(ai_providers).where(eq(ai_providers.id, id)).run();
  },
};
