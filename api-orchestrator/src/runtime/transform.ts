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

    // ── Object fields — recurse into item_schema ───────────────────────────
    // Object fields are containers. Child mappings use absolute JSONPath from
    // the root upstream document (e.g. $.patient.name.first_name). We always
    // pass the original full upstream to the recursive call so absolute paths
    // continue to work correctly regardless of nesting depth.
    // The mapping on the object field itself (e.g. patient → $.patient) is
    // informational in the UI but not used for resolution here.
    if (field.type === "object" && field.item_schema && field.item_schema.length > 0) {
      const childOutput = applyMappings(upstream, field.item_schema, mappings, field.field_path);
      setByPath(output, field.field_path, childOutput);
      continue;
    }

    // ── Array fields — iterate and recurse ────────────────────────────────
    if (mapping?.mapping_type === "array") {
      if (!mapping.upstream_path) {
        console.warn(`[transform] Array mapping for ${field.field_path} has no upstream_path`);
        setByPath(output, field.field_path, []);
        continue;
      }

      const rawResult = JSONPath({ path: mapping.upstream_path, json: upstream as object, wrap: true }) as unknown[];

      if (rawResult.length !== 1 || !Array.isArray(rawResult[0])) {
        console.error(
          `[transform] Array mapping "${mapping.upstream_path}" must resolve to exactly one array — got ${rawResult.length} result(s)`
        );
        throw Object.assign(
          new Error(`Array mapping "${mapping.upstream_path}" resolved to ${rawResult.length} node(s), expected 1 array`),
          { code: "TRANSFORM_ARRAY_PATH_ERROR" }
        );
      }

      const sourceArray = rawResult[0] as unknown[];
      const itemMappings = mapping.item_mappings ?? [];
      const itemSchema   = field.item_schema ?? [];

      const outputArray = sourceArray.map((element) => {
        if (itemSchema.length === 0 || itemMappings.length === 0) return element;
        return applyMappings(element, itemSchema, itemMappings);
      });

      setByPath(output, field.field_path, outputArray);
      continue;
    }

    // ── No mapping — auto-passthrough by field_path from current upstream context ──
    if (!mapping) {
      if (field.type === "array") {
        const value = queryOne(upstream, `$.${field.field_path}`);
        if (Array.isArray(value)) {
          if (field.item_schema && field.item_schema.length > 0) {
            setByPath(output, field.field_path, (value as unknown[]).map(el =>
              applyMappings(el, field.item_schema!, mappings)
            ));
          } else {
            setByPath(output, field.field_path, value);
          }
        } else {
          setByPath(output, field.field_path, []);
        }
        continue;
      }
      const value = queryOne(upstream, `$.${field.field_path}`);
      if (value !== undefined) {
        setByPath(output, field.field_path, value);
      } else if (!field.nullable) {
        console.warn(`[transform] No mapping for non-nullable field: ${parentPath ? parentPath + "." : ""}${field.field_path}`);
      }
      continue;
    }

    // ── Static value ────────────────────────────────────────────────────────
    if (mapping.mapping_type === "static") {
      setByPath(output, field.field_path, mapping.static_value ?? null);
      continue;
    }

    // ── Direct mapping — resolve JSONPath from upstream ────────────────────
    if (mapping.upstream_path) {
      const value = queryOne(upstream, mapping.upstream_path);
      if ((value === undefined || value === null) && !field.nullable) {
        console.warn(
          `[transform] Non-nullable field "${parentPath ? parentPath + "." : ""}${field.field_path}" has no value`
        );
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
