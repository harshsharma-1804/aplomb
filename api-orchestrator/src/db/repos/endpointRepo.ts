import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { endpoints } from "../schema.js";
import type { DrizzleDb } from "./types.js";

export type CreateEndpointInput = {
  app_id: string;
  name: string;
  method: string;
  path: string;
  description?: string;
  is_active?: boolean;
  script_mode?: string;
  script_file_id?: string | null;
  folder?: string | null;
  path_params?: unknown[];
  query_params?: unknown[];
  request?: Record<string, unknown>;
  upstream?: Record<string, unknown>;
  output_schema?: unknown[];
  field_mappings?: unknown[];
  sample_response?: unknown;
  created_by?: string;
};

const now = () => new Date().toISOString();

function serialize(row: typeof endpoints.$inferSelect) {
  return {
    ...row,
    _id:             row.id,
    folder:          row.folder ?? null,
    path_params:     JSON.parse(row.path_params    ?? "[]"),
    query_params:    JSON.parse(row.query_params   ?? "[]"),
    request:         JSON.parse(row.request        ?? "{}"),
    upstream:        JSON.parse(row.upstream       ?? "{}"),
    output_schema:   JSON.parse(row.output_schema  ?? "[]"),
    field_mappings:  JSON.parse(row.field_mappings ?? "[]"),
    sample_response: row.sample_response ? JSON.parse(row.sample_response) : null,
    is_active:       Boolean(row.is_active),
  };
}

export const endpointRepo = {
  create(db: DrizzleDb, input: CreateEndpointInput) {
    const id = randomUUID();
    const t = now();
    db.insert(endpoints).values({
      id,
      app_id:         input.app_id,
      name:           input.name.trim(),
      description:    input.description ?? "",
      method:         input.method.toUpperCase(),
      path:           input.path.trim(),
      is_active:      input.is_active ?? true,
      script_mode:    input.script_mode ?? "none",
      script_file_id: input.script_file_id ?? null,
      folder:         input.folder ?? null,
      path_params:    JSON.stringify(input.path_params    ?? []),
      query_params:   JSON.stringify(input.query_params   ?? []),
      request:        JSON.stringify(input.request        ?? {}),
      upstream:       JSON.stringify(input.upstream       ?? {}),
      output_schema:  JSON.stringify(input.output_schema  ?? []),
      field_mappings: JSON.stringify(input.field_mappings ?? []),
      sample_response: input.sample_response ? JSON.stringify(input.sample_response) : null,
      created_at: t,
      updated_at: t,
    }).run();
    return serialize(db.select().from(endpoints).where(eq(endpoints.id, id)).get()!);
  },

  findById(db: DrizzleDb, id: string) {
    const row = db.select().from(endpoints).where(eq(endpoints.id, id)).get();
    return row ? serialize(row) : null;
  },

  findByAppId(db: DrizzleDb, app_id: string) {
    return db.select().from(endpoints).where(eq(endpoints.app_id, app_id)).all().map(serialize);
  },

  findByAppAndMethod(db: DrizzleDb, app_id: string, method: string) {
    return db.select().from(endpoints)
      .where(and(eq(endpoints.app_id, app_id), eq(endpoints.method, method.toUpperCase())))
      .all()
      .map(serialize);
  },

  update(db: DrizzleDb, id: string, input: Partial<CreateEndpointInput>) {
    const patch: Record<string, unknown> = { updated_at: now() };
    if (input.name           !== undefined) patch["name"]           = input.name.trim();
    if (input.description    !== undefined) patch["description"]    = input.description;
    if (input.method         !== undefined) patch["method"]         = input.method.toUpperCase();
    if (input.path           !== undefined) patch["path"]           = input.path.trim();
    if (input.is_active      !== undefined) patch["is_active"]      = input.is_active;
    if (input.script_mode    !== undefined) patch["script_mode"]    = input.script_mode;
    if (input.script_file_id !== undefined) patch["script_file_id"] = input.script_file_id;
    if (input.folder         !== undefined) patch["folder"]         = input.folder ?? null;
    if (input.path_params    !== undefined) patch["path_params"]    = JSON.stringify(input.path_params);
    if (input.query_params   !== undefined) patch["query_params"]   = JSON.stringify(input.query_params);
    if (input.request        !== undefined) patch["request"]        = JSON.stringify(input.request);
    if (input.upstream       !== undefined) patch["upstream"]       = JSON.stringify(input.upstream);
    if (input.output_schema  !== undefined) patch["output_schema"]  = JSON.stringify(input.output_schema);
    if (input.field_mappings !== undefined) patch["field_mappings"] = JSON.stringify(input.field_mappings);
    if (input.sample_response !== undefined) patch["sample_response"] = input.sample_response ? JSON.stringify(input.sample_response) : null;
    db.update(endpoints).set(patch).where(eq(endpoints.id, id)).run();
    return endpointRepo.findById(db, id);
  },

  updateField(db: DrizzleDb, id: string, field: string, value: unknown) {
    const serialized = typeof value === "object" ? JSON.stringify(value) : value;
    db.update(endpoints).set({ [field]: serialized, updated_at: now() }).where(eq(endpoints.id, id)).run();
    return endpointRepo.findById(db, id);
  },

  delete(db: DrizzleDb, id: string) {
    db.delete(endpoints).where(eq(endpoints.id, id)).run();
  },

  deleteByAppId(db: DrizzleDb, app_id: string) {
    db.delete(endpoints).where(eq(endpoints.app_id, app_id)).run();
  },
};
