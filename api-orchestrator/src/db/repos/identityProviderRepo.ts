import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { identity_providers } from "../schema.js";
import type { DrizzleDb } from "./types.js";

const now = () => new Date().toISOString();

function serialize(row: typeof identity_providers.$inferSelect) {
  return {
    ...row,
    audience:       JSON.parse(row.audience       ?? "[]"),
    algorithms:     JSON.parse(row.algorithms     ?? '["RS256"]'),
    claim_mappings: JSON.parse(row.claim_mappings ?? "{}"),
    is_active:      Boolean(row.is_active),
  };
}

export const identityProviderRepo = {
  create(db: DrizzleDb, input: Record<string, unknown>) {
    const id = randomUUID();
    const t = now();
    db.insert(identity_providers).values({
      id,
      name:                String(input["name"] ?? ""),
      type:                String(input["type"] ?? "oidc"),
      issuer:              String(input["issuer"] ?? ""),
      jwks_uri:            input["jwks_uri"] ? String(input["jwks_uri"]) : null,
      audience:            JSON.stringify(input["audience"] ?? []),
      algorithms:          JSON.stringify(input["algorithms"] ?? ["RS256"]),
      claim_mappings:      JSON.stringify(input["claim_mappings"] ?? { subject: "sub", email: "email", roles: "groups" }),
      clock_tolerance_sec: Number(input["clock_tolerance_sec"] ?? 60),
      is_active:           input["is_active"] !== false,
      created_by:          input["created_by"] ? String(input["created_by"]) : null,
      created_at: t,
      updated_at: t,
    }).run();
    return serialize(db.select().from(identity_providers).where(eq(identity_providers.id, id)).get()!);
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(identity_providers).where(eq(identity_providers.id, id)).get();
    return row ? serialize(row) : null;
  },

  findByIssuer(db: DrizzleDb, issuer: string) {
    const row = db.select().from(identity_providers).where(eq(identity_providers.issuer, issuer)).get();
    return row ? serialize(row) : null;
  },

  listActive(db: DrizzleDb) {
    return db.select().from(identity_providers).all()
      .filter(r => r.is_active)
      .map(serialize);
  },

  list(db: DrizzleDb) {
    return db.select().from(identity_providers).all().map(serialize);
  },

  update(db: DrizzleDb, id: string, input: Record<string, unknown>) {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input["name"]                !== undefined) patch["name"]                = String(input["name"]);
    if (input["jwks_uri"]            !== undefined) patch["jwks_uri"]            = input["jwks_uri"] ? String(input["jwks_uri"]) : null;
    if (input["audience"]            !== undefined) patch["audience"]            = JSON.stringify(input["audience"]);
    if (input["algorithms"]          !== undefined) patch["algorithms"]          = JSON.stringify(input["algorithms"]);
    if (input["claim_mappings"]      !== undefined) patch["claim_mappings"]      = JSON.stringify(input["claim_mappings"]);
    if (input["clock_tolerance_sec"] !== undefined) patch["clock_tolerance_sec"] = Number(input["clock_tolerance_sec"]);
    if (input["is_active"]           !== undefined) patch["is_active"]           = Boolean(input["is_active"]);
    db.update(identity_providers).set(patch).where(eq(identity_providers.id, id)).run();
    return identityProviderRepo.findById(db, id);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(identity_providers).where(eq(identity_providers.id, id)).run();
  },
};
