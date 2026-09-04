import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { users } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type CreateUserInput = {
  username: string;
  email: string;
  password_hash: string;
  role?: string;
  must_change_password?: boolean;
  created_by?: string;
};

const now = () => new Date().toISOString();

export const userRepo = {
  create(db: DrizzleDb, input: CreateUserInput) {
    const id = randomUUID();
    const t = now();
    db.insert(users).values({
      id,
      username: input.username.toLowerCase().trim(),
      email: input.email.toLowerCase().trim(),
      password_hash: input.password_hash,
      role: input.role ?? "viewer",
      must_change_password: input.must_change_password ?? false,
      created_by: input.created_by ?? null,
      created_at: t,
      updated_at: t,
    }).run();
    const row = db.select().from(users).where(eq(users.id, id)).get()!;
    return { ...row, _id: row.id };
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(users).where(eq(users.id, id)).get();
    return row ? { ...row, _id: row.id } : null;
  },

  findByUsername(db: DrizzleDb, username: string) {
    const row = db.select().from(users).where(eq(users.username, username.toLowerCase().trim())).get();
    return row ? { ...row, _id: row.id } : null;
  },

  findByEmail(db: DrizzleDb, email: string) {
    const row = db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).get();
    return row ? { ...row, _id: row.id } : null;
  },

  list(db: DrizzleDb) {
    return db.select({
      id: users.id, username: users.username, email: users.email,
      role: users.role, is_active: users.is_active,
      must_change_password: users.must_change_password,
      failed_login_attempts: users.failed_login_attempts,
      locked_until: users.locked_until, last_login_at: users.last_login_at,
      created_by: users.created_by, created_at: users.created_at, updated_at: users.updated_at,
    }).from(users).all().map(r => ({ ...r, _id: r.id }));
  },

  updateRole(db: DrizzleDb, id: string, role: string) {
    db.update(users).set({ role, updated_at: now() }).where(eq(users.id, id)).run();
  },

  updatePassword(db: DrizzleDb, id: string, password_hash: string) {
    db.update(users).set({ password_hash, must_change_password: false, updated_at: now() }).where(eq(users.id, id)).run();
  },

  setActive(db: DrizzleDb, id: string, is_active: boolean) {
    db.update(users).set({ is_active, updated_at: now() }).where(eq(users.id, id)).run();
  },

  incrementFailedAttempts(db: DrizzleDb, id: string) {
    const u = db.select({ n: users.failed_login_attempts }).from(users).where(eq(users.id, id)).get();
    if (!u) return;
    db.update(users).set({ failed_login_attempts: (u.n ?? 0) + 1, updated_at: now() }).where(eq(users.id, id)).run();
  },

  resetFailedAttempts(db: DrizzleDb, id: string) {
    db.update(users).set({ failed_login_attempts: 0, locked_until: null, updated_at: now() }).where(eq(users.id, id)).run();
  },

  setLockout(db: DrizzleDb, id: string, until: Date) {
    db.update(users).set({ locked_until: until.toISOString(), updated_at: now() }).where(eq(users.id, id)).run();
  },

  setLastLogin(db: DrizzleDb, id: string) {
    db.update(users).set({ last_login_at: now(), updated_at: now() }).where(eq(users.id, id)).run();
  },
};
