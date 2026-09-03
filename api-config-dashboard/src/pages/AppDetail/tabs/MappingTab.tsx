import { useState } from "react";
import { api } from "../../../api/client";
import type { Endpoint, FieldMapping, SchemaField } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props { appId: string; endpoint: Endpoint; onSaved: (ep: Endpoint) => void; }

// ── Sample path extractor ─────────────────────────────────────────────────────

function extractFlatPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [];
  const paths: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    paths.push(`$.${p}`);
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") {
      extractFlatPaths(v[0] as object, `${p}[*]`).forEach(sp => paths.push(sp));
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      extractFlatPaths(v, p).forEach(sp => paths.push(sp));
    }
  }
  return paths;
}

// ── Schema flattener — handles both array AND object nesting ──────────────────

interface FlatField extends SchemaField {
  fullPath: string;
  depth: number;
}

function flattenSchema(fields: SchemaField[], prefix = "", depth = 0): FlatField[] {
  const result: FlatField[] = [];
  for (const f of fields) {
    const fullPath = prefix ? `${prefix}.${f.field_path}` : f.field_path;
    result.push({ ...f, field_path: f.field_path, fullPath, depth });

    // Recurse into object children (properties)
    if (f.type === "object" && f.item_schema && f.item_schema.length > 0) {
      flattenSchema(f.item_schema, fullPath, depth + 1).forEach(sf => result.push(sf));
    }

    // Recurse into array item schema (object items only — primitive arrays have no sub-fields)
    if (f.type === "array" && f.item_schema && f.item_schema.length > 0 && (!f.item_type || f.item_type === "object")) {
      flattenSchema(f.item_schema, `${fullPath}[]`, depth + 1).forEach(sf => result.push(sf));
    }
  }
  return result;
}

// ── Mapping row ───────────────────────────────────────────────────────────────

function MappingRow({ field, mapping, onChange, samplePaths, readOnly }: {
  field: FlatField;
  mapping?: FieldMapping;
  onChange: (m: FieldMapping) => void;
  samplePaths: string[];
  readOnly: boolean;
}) {
  const current = mapping ?? { schema_field_id: field.id, mapping_type: "direct" as const, upstream_path: "" };
  const isMapped = !!(current.upstream_path || current.static_value);

  const TYPE_COLORS: Record<string, string> = {
    string: "#0d6efd", number: "#6610f2", boolean: "#fd7e14",
    object: "#198754", array: "#e83e8c", null: "#6c757d",
  };
  const typeColor = TYPE_COLORS[field.type] ?? C.muted;

  // Object fields are containers — no direct mapping needed
  // Array-of-object fields are semi-containers — show optional upstream path input
  const isContainer = field.type === "object";
  const isArrayContainer = field.type === "array" && (!field.item_type || field.item_type === "object");

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 90px minmax(0,1fr)",
      gap: "0 8px",
      alignItems: "center",
      marginBottom: 4,
      padding: "5px 8px",
      paddingLeft: 8 + field.depth * 16,
      borderRadius: C.radius,
      border: `1px solid ${!isContainer && !isMapped ? C.danger + "44" : C.border}`,
      background: isContainer ? "#f0f7ff" : isArrayContainer ? "#f5f0ff" : (isMapped ? C.bg : "#fff9f9"),
      opacity: isContainer ? 0.85 : 1,
    }}>
      {/* Field path */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {field.depth > 0 && (
          <span style={{ color: C.border, fontSize: 11, flexShrink: 0 }}>
            {"└".padStart(field.depth, " ")}
          </span>
        )}
        <code style={{ fontSize: 11, color: C.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {field.fullPath}
        </code>
        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 99, background: typeColor + "18", color: typeColor, flexShrink: 0 }}>
          {field.type === "array" && field.item_type && field.item_type !== "object"
            ? `array of ${field.item_type}`
            : field.type}
        </span>
      </div>

      {/* Mapping type */}
      {isContainer ? (
        <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic", textAlign: "center" }}>object</div>
      ) : isArrayContainer ? (
        <div style={{ fontSize: 10, color: "#6f42c1", fontStyle: "italic", textAlign: "center" }}>array</div>
      ) : (
        <select
          value={current.mapping_type}
          onChange={e => onChange({ ...current, mapping_type: e.target.value as FieldMapping["mapping_type"] })}
          disabled={readOnly}
          style={{ fontSize: 11, padding: "3px 4px", border: `1px solid ${C.border}`, borderRadius: C.radius, background: C.surface }}
        >
          <option value="direct">direct</option>
          <option value="static">static</option>
          <option value="array">array</option>
        </select>
      )}

      {/* Upstream path */}
      {isContainer ? (
        <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>
          child fields mapped individually below ↓
        </div>
      ) : isArrayContainer ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <input
            value={current.upstream_path ?? ""}
            onChange={e => onChange({ ...current, upstream_path: e.target.value, mapping_type: "array" })}
            disabled={readOnly}
            placeholder="$.member.addresses  (optional — leave empty to infer from child mappings)"
            list={`paths-${field.id}`}
            style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${current.upstream_path ? "#6f42c1" : C.border}`, borderRadius: C.radius, width: "100%" }}
          />
          <datalist id={`paths-${field.id}`}>
            {samplePaths.map(p => <option key={p} value={p} />)}
          </datalist>
          <span style={{ fontSize: 10, color: C.muted }}>
            {current.upstream_path ? "explicit array path set" : "auto-inferred from child mappings ↓"}
          </span>
        </div>
      ) : current.mapping_type === "static" ? (
        <input
          value={current.static_value ?? ""}
          onChange={e => onChange({ ...current, static_value: e.target.value })}
          disabled={readOnly}
          placeholder="static value"
          style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: C.radius, width: "100%" }}
        />
      ) : (
        <>
          <input
            value={current.upstream_path ?? ""}
            onChange={e => onChange({ ...current, upstream_path: e.target.value })}
            disabled={readOnly}
            placeholder={field.type === "array" ? "$.results (resolves array)" : "$.claim_number"}
            list={`paths-${field.id}`}
            style={{ fontSize: 11, padding: "3px 8px", border: `1px solid ${C.border}`, borderRadius: C.radius, width: "100%" }}
          />
          <datalist id={`paths-${field.id}`}>
            {samplePaths.map(p => <option key={p} value={p} />)}
          </datalist>
        </>
      )}
    </div>
  );
}

// ── Main MappingTab ───────────────────────────────────────────────────────────

export function MappingTab({ appId, endpoint, onSaved }: Props) {
  const { can } = useSession();
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>(endpoint.field_mappings ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const samplePaths = endpoint.sample_response ? extractFlatPaths(endpoint.sample_response.json) : [];
  const flatSchema = flattenSchema(endpoint.output_schema ?? []);

  const readOnly = !can("edit:endpoints");

  function getMapping(fieldId: string) {
    return fieldMappings.find(m => m.schema_field_id === fieldId);
  }

  function updateMapping(m: FieldMapping) {
    setFieldMappings(prev => {
      const without = prev.filter(x => x.schema_field_id !== m.schema_field_id);
      return [...without, m];
    });
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/mappings`, fieldMappings);
      onSaved(ep);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  const mappableFields = flatSchema.filter(f => f.type !== "object");
  const unmapped = mappableFields.filter(f => !getMapping(f.id)?.upstream_path && !getMapping(f.id)?.static_value).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <SectionHead
          title={`Response Mapping — ${mappableFields.length} mappable fields, ${unmapped} unmapped`}
          action={!readOnly ? <Btn size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Mappings"}</Btn> : undefined}
        />
        <div style={{ padding: 12 }}>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr", gap: "0 8px", marginBottom: 8, padding: "4px 8px" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>OUTPUT FIELD (your schema)</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>TYPE</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>
              UPSTREAM PATH{samplePaths.length > 0 && <span style={{ fontWeight: 400 }}> — type to autocomplete from sample</span>}
            </span>
          </div>

          {flatSchema.length === 0 ? (
            <p style={{ fontSize: 12, color: C.muted, padding: "8px 0" }}>
              Define the Response Schema first, then come back here to map each field to its upstream path.
            </p>
          ) : (
            flatSchema.map(field => (
              <MappingRow
                key={field.id}
                field={field}
                mapping={getMapping(field.id)}
                onChange={updateMapping}
                samplePaths={samplePaths}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      </Card>

      {["POST","PUT","PATCH"].includes(endpoint.method) && (
        <Card>
          <SectionHead title="Request Body Mapping — Upstream ← Your Input" />
          <div style={{ padding: 12 }}>
            <div style={{ padding: 10, background: "#e8f4fd", borderRadius: C.radius, fontSize: 12, color: "#0c4a6e", marginBottom: 8 }}>
              <strong>Direction is reversed here.</strong> Each row maps an <em>upstream field</em> to a source from <em>your input</em>.
              Configure these in the <strong>Upstream tab → body_mappings</strong>.
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
