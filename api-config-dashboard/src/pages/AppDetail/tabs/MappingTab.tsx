import { ArrowLeft, Info } from "lucide-react";
import { usePageSave } from "../../../components/PageSave";
import { useState } from "react";
import { api } from "../../../api/client";
import type { Endpoint, FieldMapping, SchemaField } from "../../../api/types";
import { Card, SectionHead, Btn, ErrorBanner, C } from "../../../components";
import { useSession } from "../../../auth/SessionContext";

interface Props { appId: string; endpoint: Endpoint; onSaved: (ep: Endpoint) => void; }

// ── Sample path extractor ─────────────────────────────────────────────────────

function extractFlatPaths(obj: unknown, prefix = ""): string[] {
  // Root-level array (e.g. PostgREST/Supabase): extract from the first item so
  // paths are item-relative ($.id, $.name) — matches output_array_mode, where
  // mappings are applied per item.
  if (Array.isArray(obj)) {
    return obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null
      ? extractFlatPaths(obj[0] as object, prefix)
      : [];
  }
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
    string: "var(--primary)", number: "var(--primary)", boolean: "var(--warning)",
    object: "var(--success)", array: "var(--primary)", null: "var(--muted)",
  };
  const typeColor = TYPE_COLORS[field.type] ?? C.muted;

  // Object fields are containers — no direct mapping needed
  // Array-of-object fields are semi-containers — show optional upstream path input
  const isContainer = field.type === "object";
  const isArrayContainer = field.type === "array" && (!field.item_type || field.item_type === "object");

  return <div className={`ui-map__row ${isContainer ? "is-parent" : ""}`}>
    <span className="ui-row" style={{paddingLeft:field.depth*18}}><span className="ui-frow__name">{field.fullPath}</span><span className="ui-type">{field.type==="array" && field.item_type ? `array of ${field.item_type}` : field.type}</span></span>
    {isContainer ? <span/> : <ArrowLeft/>}
    {isContainer ? <span className="ui-faint" style={{fontSize:12}}>object</span> : <select className="ui-select ui-select--sm" aria-label={`${field.fullPath} type`} value={isArrayContainer ? "array" : current.mapping_type} disabled={readOnly || isArrayContainer} onChange={e=>onChange({...current,mapping_type:e.target.value as FieldMapping["mapping_type"]})}><option value="direct">direct</option><option value="static">static</option><option value="array">array</option></select>}
    {isContainer ? <span className="ui-faint" style={{fontSize:12}}>Child fields are mapped individually below</span> : <div><input className="ui-input ui-input--sm ui-input--mono" aria-label={`${field.fullPath} ${current.mapping_type==="static" ? "value" : "path"}`} value={current.mapping_type==="static" ? current.static_value ?? "" : current.upstream_path ?? ""} disabled={readOnly} placeholder={isArrayContainer ? "Optional array path — inferred from children" : current.mapping_type==="static" ? "Static value" : "$.claim_number"} list={current.mapping_type==="static" ? undefined : `paths-${field.id}`} onChange={e=>onChange(current.mapping_type==="static" ? {...current,static_value:e.target.value} : {...current,upstream_path:e.target.value,...(isArrayContainer ? {mapping_type:"array" as const} : {})})}/><datalist id={`paths-${field.id}`}>{samplePaths.map(p=><option key={p} value={p}/>)}</datalist></div>}
  </div>;

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

  usePageSave({fieldMappings},save,{enabled:can("edit:endpoints"),disabled:saving});

  async function save() {
    setSaving(true); setError("");
    try {
      const ep = await api.put<Endpoint>(`/__config/apps/${appId}/endpoints/${endpoint._id}/mappings`, fieldMappings);
      onSaved(ep);
    } catch (e) { setError(String(e)); throw e; }
    finally { setSaving(false); }
  }

  const mappableFields = flatSchema.filter(f => f.type !== "object");
  const unmapped = mappableFields.filter(f => !getMapping(f.id)?.upstream_path && !getMapping(f.id)?.static_value).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <ErrorBanner message={error} />}

      <Card>
        <div className="ui-card__head"><h2 className="ui-card__title ui-row">Response mapping <span className={`ui-badge ${unmapped ? "ui-badge--warning" : "ui-badge--success"}`}><i className="ui-dot"/>{mappableFields.length-unmapped} of {mappableFields.length} mapped</span></h2></div>
        <div>
          <div className="ui-map__head"><span>Output field</span><span/><span>Type</span><span>Upstream path</span></div>
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
          <div className="ui-card__body">
            <div className="ui-callout"><Info/><span>
              <strong>Direction is reversed here.</strong> Each row maps an <em>upstream field</em> to a source from <em>your input</em>.
              Configure these in the <strong>Upstream step → body_mappings</strong>.
            </span></div>
          </div>
        </Card>
      )}
    </div>
  );
}
