import { JSONPath } from "jsonpath-plus";

export interface ISchemaField {
  id: string; field_path: string; type: string; nullable: boolean;
  description: string; sort_order: number; item_schema?: ISchemaField[];
}
export interface IFieldMapping {
  schema_field_id: string; upstream_path?: string; static_value?: string;
  mapping_type: string; item_mappings?: IFieldMapping[];
}

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
      // Relativize absolute upstream paths for child mappings so they resolve
      // correctly against the subtree (e.g. "$.member.id" → "$.id" when
      // recursing into the "member" subtree).
      const prefix = `$.${field.field_path}.`;
      const relativizedMappings = mappings.map(m =>
        m.upstream_path?.startsWith(prefix)
          ? { ...m, upstream_path: "$." + m.upstream_path.slice(prefix.length) }
          : m
      );
      const childOutput = applyMappings(subtree, field.item_schema, relativizedMappings, field.field_path);
      setByPath(output, field.field_path, childOutput);
      continue;
    }

    // ── Array fields — 3-step resolution ─────────────────────────────────
    if (field.type === "array") {
      const itemSchema = field.item_schema ?? [];

      // Step 1 — explicit top-level mapping with upstream_path
      // Operator explicitly configured where the array lives in upstream.
      let arrayPath: string | null = null;
      let topLevelItemMappings: IFieldMapping[] = [];

      if (mapping?.upstream_path) {
        arrayPath = mapping.upstream_path;
        topLevelItemMappings = mapping.item_mappings ?? [];
      }

      // Step 2 — infer from child mappings when no explicit top-level mapping
      // Look through all top-level field_mappings for entries belonging to
      // children of this array field. If any child mapping has [*] in its path,
      // strip from [*] onwards to get the parent array path.
      if (!arrayPath && itemSchema.length > 0) {
        const childIds = new Set(itemSchema.map(f => f.id));
        // Also collect ids from nested item_schemas (for nested objects inside array)
        function collectIds(fields: ISchemaField[]) {
          for (const f of fields) {
            childIds.add(f.id);
            if (f.item_schema) collectIds(f.item_schema);
          }
        }
        collectIds(itemSchema);

        for (const [, m] of mappingById) {
          if (childIds.has(m.schema_field_id) && m.upstream_path && m.upstream_path.includes("[*]")) {
            const bracketIdx = m.upstream_path.indexOf("[*]");
            arrayPath = m.upstream_path.slice(0, bracketIdx);
            break;
          }
        }
      }

      // Step 3 — fallback to $.fieldName from current upstream context
      if (!arrayPath) {
        arrayPath = `$.${field.field_path}`;
      }

      const rawResult = JSONPath({ path: arrayPath, json: upstream as object, wrap: true }) as unknown[];

      if (rawResult.length === 0 || !Array.isArray(rawResult[0])) {
        // Not found or not an array — return empty
        setByPath(output, field.field_path, []);
        continue;
      }

      const sourceArray = rawResult[0] as unknown[];

      if (itemSchema.length === 0) {
        // Primitive array — passthrough as-is
        setByPath(output, field.field_path, sourceArray);
        continue;
      }

      const outputArray = sourceArray.map((element) => {
        if (topLevelItemMappings.length > 0) {
          // Explicit item mappings provided — relativize and recurse
          const relMappings = relativizeMappings(topLevelItemMappings, arrayPath!);
          return applyMappings(element, itemSchema, relMappings);
        }
        // No explicit item mappings — relativize top-level mappings using inferred array path
        // so that $.member.addresses[*].street_name_1 → $.street_name_1 against element
        const relMappings = relativizeMappings([...mappingById.values()], arrayPath!);
        return applyMappings(element, itemSchema, relMappings);
      });

      setByPath(output, field.field_path, outputArray);
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
