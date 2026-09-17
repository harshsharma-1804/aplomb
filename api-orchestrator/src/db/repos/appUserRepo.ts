import { and, eq, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { app_users, type AppUser } from "../schema.js";
import type { DrizzleDb } from "./types.js";

/**
 * Per-app gateway-auth users. Completely disjoint from `users` (dashboard admins):
 * every query here filters by app_id, and dashboard auth never reads this table.
 * See Execution Plan/Orchestrator/Features/AppScopedSessions-9.md
 */

export type SerializedAppUser = {
  id: string; app_id: string; username: string; email: string;
  sub: string; display_name: string | null; is_active: boolean;
  created_at: string; updated_at: string;
};

export type CreateAppUserInput = {
  app_id: string;
  username: string;
  email: string;
  password: string;
  /**
   * Verified identity bound into the session (e.g. a member ID on
   * member-scoped apps). Optional — defaults to the username for apps
   * whose users have no external identity (e.g. admin consoles).
   */
  sub?: string;
  display_name?: string;
};

function serialize(row: AppUser): SerializedAppUser {
  return {
    id: row.id,
    app_id: row.app_id,
    username: row.username,
    email: row.email,
    sub: row.sub,
    display_name: row.display_name,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const appUserRepo = {
  async create(db: DrizzleDb, input: CreateAppUserInput): Promise<SerializedAppUser> {
    const id = randomUUID();
    const t = new Date().toISOString();
    const password_hash = await argon2Hash(input.password);
    db.insert(app_users).values({
      id,
      app_id: input.app_id,
      username: input.username.trim(),
      email: input.email.trim().toLowerCase(),
      password_hash,
      sub: input.sub?.trim() || input.username.trim(),
      display_name: input.display_name ?? null,
      is_active: true,
      created_at: t,
      updated_at: t,
    }).run();
    return serialize(db.select().from(app_users).where(eq(app_users.id, id)).get()!);
  },

  async setPassword(db: DrizzleDb, id: string, password: string): Promise<void> {
    const password_hash = await argon2Hash(password);
    db.update(app_users).set({ password_hash, updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean): void {
    db.update(app_users).set({ is_active, updated_at: new Date().toISOString() })
      .where(eq(app_users.id, id)).run();
  },

  update(db: DrizzleDb, id: string, patch: { display_name?: string; email?: string; sub?: string }): void {
    const p: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.display_name !== undefined) p["display_name"] = patch.display_name;
    if (patch.email !== undefined) p["email"] = patch.email.trim().toLowerCase();
    if (patch.sub !== undefined) p["sub"] = patch.sub.trim();
    db.update(app_users).set(p).where(eq(app_users.id, id)).run();
  },

  delete(db: DrizzleDb, id: string): void {
    db.delete(app_users).where(eq(app_users.id, id)).run();
  },

  listByApp(db: DrizzleDb, appId: string): SerializedAppUser[] {
    return db.select().from(app_users).where(eq(app_users.app_id, appId)).all().map(serialize);
  },

  /**
   * Gateway credential verification. Looks ONLY within this app's user set —
   * an admin's dashboard credentials can never authenticate here, and this
   * user can never authenticate to the dashboard (disjoint stores).
   */
  async verifyCredentials(db: DrizzleDb, appId: string, identifier: string, password: string): Promise<SerializedAppUser | null> {
    const ident = identifier.trim();
    const row = db.select().from(app_users).where(and(
      eq(app_users.app_id, appId),
      or(eq(app_users.username, ident), eq(app_users.email, ident.toLowerCase())),
    )).get();
    if (!row || !row.is_active) return null;
    const ok = await argon2Verify(row.password_hash, password);
    return ok ? serialize(row) : null;
  },
};
