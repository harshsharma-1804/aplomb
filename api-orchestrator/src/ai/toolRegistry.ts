import { getDb } from "../db/client.js";
import { appRepo } from "../db/repos/appRepo.js";
import { endpointRepo } from "../db/repos/endpointRepo.js";
import type { ISchemaField } from "../runtime/inputValidator.js";

// Backend ISchemaField lacks item_type (frontend-only field) — the DB JSON
// blob may still carry it, so read it defensively here.
type RegistryField = ISchemaField & { item_type?: string };

/**
 * Converts the orchestrator's AI-exposed endpoints into LLM/MCP tool
 * definitions. JSON Schema is derived from the endpoint's existing
 * path_params, query_params and request.input_schema.
 */

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  // execution metadata — never sent to the LLM
  _exec: {
    app_id: string;
    app_base_path: string;
    endpoint_id: string;
    method: string;
    path: string;
  };
}

function sanitiseName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase().slice(0, 60);
}

// SchemaField tree → JSON Schema properties
function schemaFieldsToJsonSchema(fields: RegistryField[] | undefined): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const f of fields ?? []) {
    const jsType = f.type === "number" ? "number"
      : f.type === "boolean" ? "boolean"
      : f.type === "object" ? "object"
      : f.type === "array" ? "array"
      : f.type === "null" ? "null"
      : "string";

    const prop: Record<string, unknown> = { type: jsType };
    if (f.description) prop["description"] = f.description;

    if (jsType === "object" && f.item_schema) {
      const nested = schemaFieldsToJsonSchema(f.item_schema) as any;
      prop["properties"] = nested.properties;
      if (nested.required?.length) prop["required"] = nested.required;
    }
    if (jsType === "array") {
      if (f.item_type === "object" && f.item_schema) {
        const nested = schemaFieldsToJsonSchema(f.item_schema) as any;
        prop["items"] = { type: "object", properties: nested.properties, ...(nested.required?.length ? { required: nested.required } : {}) };
      } else if (f.item_type) {
        prop["items"] = { type: f.item_type };
      } else {
        prop["items"] = {};
      }
    }

    properties[f.field_path] = prop;
    if (!f.nullable) required.push(f.field_path);
  }

  return { properties, required };
}

export function buildTools(): ToolDef[] {
  const db = getDb();
  const tools: ToolDef[] = [];

  const apps = appRepo.list(db).filter(a => a.ai_expose && a.status === "active");

  for (const app of apps) {
    const endpoints = endpointRepo.findByAppId(db, app.id);
    for (const ep of endpoints) {
      if (!ep.is_active) continue;

      const request = (ep.request ?? {}) as any;
      const inputSchema = (request.input_schema ?? []) as RegistryField[];

      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      // path params — always required
      for (const pp of (ep.path_params ?? []) as any[]) {
        properties[pp.name] = { type: "string", description: `Path parameter ${pp.name}` };
        required.push(pp.name);
      }

      // query params — optional unless default implies required
      for (const qp of (ep.query_params ?? []) as any[]) {
        if (!properties[qp.frontend_param]) {
          properties[qp.frontend_param] = {
            type: "string",
            description: `Query parameter (upstream: ${qp.upstream_param})`,
          };
        }
      }

      // body fields from input schema
      if (inputSchema?.length) {
        const bodySchema = schemaFieldsToJsonSchema(inputSchema) as any;
        for (const [k, v] of Object.entries(bodySchema.properties ?? {})) {
          properties[k] = v;
        }
        for (const r of bodySchema.required ?? []) {
          if (!required.includes(r)) required.push(r);
        }
      }

      const toolName = sanitiseName(`${app.base_path}_${ep.name}`);
      const description = ep.description?.trim()
        ? `${ep.description} (${ep.method} ${app.base_path}${ep.path})`
        : `${ep.method} ${app.base_path}${ep.path}`;

      tools.push({
        name: toolName,
        description,
        parameters: {
          type: "object",
          properties,
          ...(required.length ? { required } : {}),
        },
        _exec: {
          app_id: app.id,
          app_base_path: app.base_path,
          endpoint_id: ep.id,
          method: ep.method,
          path: ep.path,
        },
      });
    }
  }

  return tools;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let cache: ToolDef[] = [];
let cacheLoaded = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;

export function initToolRegistry(): void {
  refreshToolRegistry();
  console.log(`[ai] Tool registry loaded: ${cache.length} tools from AI-exposed apps`);
  // Safety-net poll — explicit refreshes happen on app/endpoint writes
  pollInterval = setInterval(() => { try { refreshToolRegistry(); } catch {} }, 30_000);
  pollInterval.unref();
}

export function stopToolRegistryPolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

export function refreshToolRegistry(): void {
  cache = buildTools();
  cacheLoaded = true;
}

export function getTools(): ToolDef[] {
  if (!cacheLoaded) refreshToolRegistry();
  return cache;
}

/**
 * Per-bot tool catalog — bot's allowed apps ∩ AI-exposed apps.
 * Deny-by-default: a bot with no assigned apps sees no tools.
 */
export function getToolsForBot(allowedAppIds: string[]): ToolDef[] {
  if (!allowedAppIds.length) return [];
  const allowed = new Set(allowedAppIds);
  return getTools().filter(t => allowed.has(t._exec.app_id));
}

export function findTool(name: string): ToolDef | undefined {
  return getTools().find(t => t.name === name);
}

/**
 * Find a tool for a specific bot — same as findTool but restricted to
 * the bot's allowed apps. Used by tools/call enforcement.
 */
export function findToolForBot(name: string, allowedAppIds: string[]): ToolDef | undefined {
  return getToolsForBot(allowedAppIds).find(t => t.name === name);
}
