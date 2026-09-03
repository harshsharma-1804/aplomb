import { JSONPath } from "jsonpath-plus";
import type { ISchemaField, IFieldMapping } from "../models/Endpoint.js";

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function queryOne(json: unknown, path: string): unknown {
  const result = JSONPath({ path, json: json as object, wrap: true }) as unknown[];
  return result[0];
}

/**
 * Strip the array ancestor prefix from an absolute upstream path so it becomes
 * relative to a single array element.
 *
 * Examples:
 *   stripArrayPrefix("$.members[*].id",              "$.members")  → "$.id"
 *   stripArrayPrefix("$.members[*].name.first_name", "$.members")  → "$.name.first_name"
 *   stripArrayPrefix("$.members[*].addresses[*].street","$.members") → "$.addresses[*].street"
 *
 * If the path does not start with the expected prefix it is returned unchanged
 * so mixed absolute/relative mappings on the same array both work safely.
 */
function stripArrayPrefix(upstreamPath: string, arrayPath: string): string {
  const prefix = arrayPath.replace(/\[\*\]$/, "") + "[*].";
  if (upstreamPath.startsWith(prefix)) {
    return "$." + upstreamPath.slice(prefix.length);
  }
  return upstreamPath;
}

/**
 * Relativize all upstream_path values in a set of item mappings by stripping
 * the array ancestor prefix. Applied recursively for nested arrays.
 */
function relativizeMappings(mappings: IFieldMapping[], arrayPath: string): IFieldMapping[] {
  return mappings.map(m => ({
    ...m,
    upstream_path: m.upstream_path ? stripArrayPrefix(m.upstream_path, arrayPath) : m.upstream_path,
    item_mappings: m.item_mappings ? relativizeMappings(m.item_mappings, arrayPath) : m.item_mappings,
  }));
}

function applyMappings(
  upstream: unknown,
  schema: ISchemaField[],
  mappings: IFieldMapping[],
  parentPath = ""
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const mappingById = new Map(mappings.map((m) => [m.schema_field_id, m]));
  const sorted = [...schema].sort((a, b) => a.sort_order - b.sort_order);

  for (const field of sorted) {
    const mapping = mappingById.get(field.id);

    // ── Object fields — scope to the object subtree then recurse ──────────
    // Extract the subtree at this field's path from the current upstream context
    // so child mappings (relative or absolute within this level) resolve correctly.
    if (field.type === "object" && field.item_schema && field.item_schema.length > 0) {
      const subtree = queryOne(upstream, `$.${field.field_path}`) ?? upstream;
      const childOutput = applyMappings(subtree, field.item_schema, mappings, field.field_path);
      setByPath(output, field.field_path, childOutput);
      continue;
    }

    // ── Array fields with explicit mapping ────────────────────────────────
    if (field.type === "array" && mapping?.mapping_type === "array") {
      if (!mapping.upstream_path) {
        console.warn(`[transform] Array mapping for ${field.field_path} has no upstream_path`);
        setByPath(output, field.field_path, []);
        continue;
      }

      const rawResult = JSONPath({ path: mapping.upstream_path, json: upstream as object, wrap: true }) as unknown[];

      if (rawResult.length !== 1 || !Array.isArray(rawResult[0])) {
        console.error(`[transform] Array mapping "${mapping.upstream_path}" must resolve to exactly one array — got ${rawResult.length} result(s)`);
        throw Object.assign(
          new Error(`Array mapping "${mapping.upstream_path}" resolved to ${rawResult.length} node(s), expected 1 array`),
          { code: "TRANSFORM_ARRAY_PATH_ERROR" }
        );
      }

      const sourceArray = rawResult[0] as unknown[];
      const itemSchema = field.item_schema ?? [];
      const itemMappings = mapping.item_mappings ?? [];

      const outputArray = sourceArray.map((element) => {
        if (itemSchema.length === 0) return element;
        if (itemMappings.length === 0) {
          // No item mappings — auto-passthrough each element field by name
          return applyMappings(element, itemSchema, []);
        }
        // Relativize absolute item mapping paths so they resolve against the element
        const relMappings = relativizeMappings(itemMappings, mapping.upstream_path!);
        return applyMappings(element, itemSchema, relMappings);
      });

      setByPath(output, field.field_path, outputArray);
      continue;
    }

    // ── Array fields with no mapping — auto-passthrough ───────────────────
    if (field.type === "array" && !mapping) {
      const value = queryOne(upstream, `$.${field.field_path}`);
      if (Array.isArray(value)) {
        const itemSchema = field.item_schema ?? [];
        if (itemSchema.length > 0) {
          // Recurse into each element with auto-passthrough (empty mappings)
          setByPath(output, field.field_path, (value as unknown[]).map(el =>
            applyMappings(el, itemSchema, [])
          ));
        } else {
          // Primitive array — passthrough as-is
          setByPath(output, field.field_path, value);
        }
      } else {
        setByPath(output, field.field_path, []);
      }
      continue;
    }

    // ── No mapping — auto-passthrough scalar/object by field name ─────────
    if (!mapping) {
      const value = queryOne(upstream, `$.${field.field_path}`);
      if (value !== undefined) {
        setByPath(output, field.field_path, value);
      } else if (!field.nullable) {
        console.warn(`[transform] No mapping for non-nullable field: ${parentPath ? parentPath + "." : ""}${field.field_path}`);
      }
      continue;
    }

    // ── Static value ──────────────────────────────────────────────────────
    if (mapping.mapping_type === "static") {
      setByPath(output, field.field_path, mapping.static_value ?? null);
      continue;
    }

    // ── Direct mapping — resolve JSONPath from current upstream context ────
    if (mapping.upstream_path) {
      const value = queryOne(upstream, mapping.upstream_path);
      if ((value === undefined || value === null) && !field.nullable) {
        console.warn(`[transform] Non-nullable field "${parentPath ? parentPath + "." : ""}${field.field_path}" has no value`);
      }
      setByPath(output, field.field_path, value ?? null);
    }
  }

  return output;
}

export function applyTransform(
  upstreamJson: unknown,
  outputSchema: ISchemaField[],
  fieldMappings: IFieldMapping[]
): Record<string, unknown> {
  return applyMappings(upstreamJson, outputSchema, fieldMappings);
}
