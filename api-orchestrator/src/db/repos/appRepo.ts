import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { apps } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type SessionConfig = {
  cookie_name?: string;
  ttl_idle_min?: number;
  max_age_min?: number;
  max_sessions_per_user?: number;
  ua_enforce?: "off" | "flag" | "enforce";
  // ── Identity-provider login (see specs/IdentityProviderLoginSpecs-3.md) ────
  /** Allowlisted post-login redirect targets. Exact origin ("https://app.example.com")
   *  or origin+prefix ("https://app.example.com/dashboard"). Empty = redirects rejected. */
  login_redirect_allowlist?: string[];
  /** Default landing page after email verification when no explicit target given. */
  post_login_redirect?: string;
  /** Attach a proven IdP identity to an existing verified gateway user (default true). */
  link_identity_on_verified_email?: boolean;
  /** Require verified email before gateway login (self-signup users). Default true. */
  require_email_verification?: boolean;
  /** Allow gateway users to self-enroll in two-factor auth (default true). */
  twofa_available?: boolean;
};

export type SerializedApp = {
  id: string; name: string; base_path: string; description: string | null;
  status: string; deprecated_at: string | null; auth_required: boolean;
  mode: string; app_env: any[]; allowed_provider_ids: string[];
  auth_mode: string; session_method: string; session_config: SessionConfig;
  created_by: string | null; created_at: string; updated_at: string;
};

export type CreateAppInput = {
  name: string;
  base_path: string;
  description?: string;
  status?: string;
  auth_required?: boolean;
  ai_expose?: boolean;
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
    _id:                  row.id,
    app_env:              JSON.parse(row.app_env ?? "[]"),
    allowed_provider_ids: JSON.parse(row.allowed_provider_ids ?? "[]"),
    auth_required:        Boolean(row.auth_required),
    ai_expose:            Boolean(row.ai_expose),
    auth_mode:            row.auth_mode ?? "bearer",
    session_method:       row.session_method ?? "both",
    session_config:       JSON.parse(row.session_config ?? "{}"),
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
      ai_expose: input.ai_expose ?? false,
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
    if (input.ai_expose     !== undefined) patch["ai_expose"]     = input.ai_expose;
    if (input.deprecated_at !== undefined) patch["deprecated_at"] = input.deprecated_at;
    if (input.app_env     !== undefined) patch["app_env"]     = JSON.stringify(input.app_env);
    if (input.allowed_provider_ids !== undefined) patch["allowed_provider_ids"] = JSON.stringify(input.allowed_provider_ids);
    if ((input as any).auth_mode      !== undefined) patch["auth_mode"]      = (input as any).auth_mode;
    if ((input as any).session_method !== undefined) patch["session_method"] = (input as any).session_method;
    if ((input as any).session_config !== undefined) patch["session_config"] = JSON.stringify((input as any).session_config);
    db.update(apps).set(patch).where(eq(apps.id, id)).run();
    return appRepo.findById(db, id);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(apps).where(eq(apps.id, id)).run();
  },
};
