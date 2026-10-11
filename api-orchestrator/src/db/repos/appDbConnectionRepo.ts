import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { app_db_connections } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type DbConnectionType = "mongodb" | "postgresql" | "mysql";

export type SerializedDbConnection = {
  id: string;
  app_id: string;
  name: string;
  db_type: DbConnectionType;
  host: string;
  database: string;
  username: string | null;
  secret_id: string | null;
  options: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateDbConnectionInput = {
  app_id: string;
  name: string;
  db_type: DbConnectionType;
  host: string;
  database: string;
  username?: string | null;
  secret_id?: string | null;
  options?: Record<string, unknown>;
  created_by?: string | null;
};

export type UpdateDbConnectionInput = Partial<Omit<CreateDbConnectionInput, "app_id" | "created_by">>;

const now = () => new Date().toISOString();

function serialize(row: typeof app_db_connections.$inferSelect): SerializedDbConnection {
  return {
    ...row,
    id:       row.id,
    db_type:  row.db_type as DbConnectionType,
    username: row.username ?? null,
    secret_id: row.secret_id ?? null,
    options:  JSON.parse(row.options ?? "{}"),
    created_by: row.created_by ?? null,
  };
}

export const appDbConnectionRepo = {
  list(db: DrizzleDb, appId: string): SerializedDbConnection[] {
    return db
      .select()
      .from(app_db_connections)
      .where(eq(app_db_connections.app_id, appId))
      .all()
      .map(serialize);
  },

  findById(db: DrizzleDb, id: string): SerializedDbConnection | null {
    const row = db.select().from(app_db_connections).where(eq(app_db_connections.id, id)).get();
    return row ? serialize(row) : null;
  },

  findByIdAndApp(db: DrizzleDb, id: string, appId: string): SerializedDbConnection | null {
    const row = db
      .select()
      .from(app_db_connections)
      .where(and(eq(app_db_connections.id, id), eq(app_db_connections.app_id, appId)))
      .get();
    return row ? serialize(row) : null;
  },

  create(db: DrizzleDb, input: CreateDbConnectionInput): SerializedDbConnection {
    const id = randomUUID();
    const ts = now();
    db.insert(app_db_connections).values({
      id,
      app_id:     input.app_id,
      name:       input.name.trim(),
      db_type:    input.db_type,
      host:       input.host.trim(),
      database:   input.database.trim(),
      username:   input.username?.trim() ?? null,
      secret_id:  input.secret_id ?? null,
      options:    JSON.stringify(input.options ?? {}),
      created_by: input.created_by ?? null,
      created_at: ts,
      updated_at: ts,
    }).run();
    return this.findById(db, id)!;
  },

  update(db: DrizzleDb, id: string, input: UpdateDbConnectionInput): SerializedDbConnection | null {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name     !== undefined) patch.name     = input.name.trim();
    if (input.db_type  !== undefined) patch.db_type  = input.db_type;
    if (input.host     !== undefined) patch.host     = input.host.trim();
    if (input.database !== undefined) patch.database = input.database.trim();
    if ("username"  in input) patch.username  = input.username?.trim() ?? null;
    if ("secret_id" in input) patch.secret_id = input.secret_id ?? null;
    if (input.options  !== undefined) patch.options  = JSON.stringify(input.options);
    db.update(app_db_connections).set(patch).where(eq(app_db_connections.id, id)).run();
    return this.findById(db, id);
  },

  delete(db: DrizzleDb, id: string): void {
    db.delete(app_db_connections).where(eq(app_db_connections.id, id)).run();
  },
};
