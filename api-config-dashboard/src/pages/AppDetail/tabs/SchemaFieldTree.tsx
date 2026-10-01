import { useState } from "react";
import type { SchemaField } from "../../../api/types";
import { Btn, Field, inputStyle, C } from "../../../components";

let nextId = 1;
function genId() { return `f${Date.now()}${nextId++}`; }

const TYPE_COLORS: Record<string, string> = {
  string:  "var(--primary)", number: "var(--primary)", boolean: "var(--warning)",
  object:  "var(--success)", array:  "var(--primary)", null:    "var(--muted)",
};

interface Props {
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
  readOnly?: boolean;
  depth?: number;
  parentPath?: string;
}

export function SchemaFieldTree({ fields, onChange, readOnly = false, depth = 0, parentPath = "" }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [newField, setNewField] = useState<Partial<SchemaField>>({
    type: "string", item_type: "object", nullable: false, description: "",
  });

  function addField() {
    if (!newField.field_path?.trim()) return;
    const isArray  = newField.type === "array";
    const isObject = newField.type === "object";
    const hasChildren = isObject || (isArray && newField.item_type === "object");
    const field: SchemaField = {
      id:          genId(),
      field_path:  newField.field_path!.trim(),
      type:        newField.type ?? "string",
      item_type:   isArray ? (newField.item_type ?? "object") : undefined,
      nullable:    newField.nullable ?? false,
      description: newField.description ?? "",
      sort_order:  fields.length,
      item_schema: hasChildren ? [] : undefined,
    };
    onChange([...fields, field]);
    setNewField({ type: "string", item_type: "object", nullable: false, description: "" });
    setShowAdd(false);
  }

  function removeField(id: string) { onChange(fields.filter(f => f.id !== id)); }

  function updateField(id: string, updated: SchemaField) {
    onChange(fields.map(f => f.id === id ? updated : f));
  }

  function updateChildren(id: string, children: SchemaField[]) {
    onChange(fields.map(f => f.id === id ? { ...f, item_schema: children } : f));
  }

  const showItemType = newField.type === "array";

  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0, borderLeft: depth > 0 ? `2px solid ${C.border}` : "none", marginLeft: depth > 0 ? 8 : 0 }}>
      {fields.map(f => (
        <FieldRow
          key={f.id}
          field={f}
          depth={depth}
          parentPath={parentPath}
          readOnly={readOnly}
          onRemove={() => removeField(f.id)}
          onUpdate={updated => updateField(f.id, updated)}
          onChildrenChange={children => updateChildren(f.id, children)}
        />
      ))}

      {!readOnly && (
        <div style={{ marginTop: 6 }}>
          {!showAdd ? (
            <Btn size="sm" variant="ghost" onClick={() => setShowAdd(true)}>
              + Add Field{parentPath ? ` to ${parentPath}` : ""}
            </Btn>
          ) : (
            <div style={{ padding: 12, background: "var(--surface-muted)", borderRadius: C.radius, border: `1px solid ${C.border}` }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: "0 8px", alignItems: "end" }}>
                <Field label="Field Name">
                  <input
                    style={inputStyle} autoFocus
                    value={newField.field_path ?? ""}
                    onChange={e => setNewField(f => ({ ...f, field_path: e.target.value }))}
                    placeholder={parentPath ? "e.g. first_name" : "e.g. claim_number"}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addField(); } }}
                  />
                  {parentPath && (
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                      Full path: <code style={{ color: C.primary }}>{parentPath}.{newField.field_path || "…"}</code>
                    </div>
                  )}
                </Field>
                <Field label="Type">
                  <select style={inputStyle} value={newField.type} onChange={e => setNewField(f => ({ ...f, type: e.target.value as SchemaField["type"] }))}>
                    {["string","number","boolean","object","array","null"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <div style={{ display: "flex", gap: 4, paddingBottom: 2 }}>
                  <Btn size="sm" onClick={addField} disabled={!newField.field_path?.trim()}>Add</Btn>
                  <Btn size="sm" variant="ghost" onClick={() => setShowAdd(false)}>✕</Btn>
                </div>
              </div>

              {showItemType && (
                <Field label="Array Item Type" hint="What each element in the array contains">
                  <select style={{ ...inputStyle, marginTop: 2 }} value={newField.item_type ?? "object"} onChange={e => setNewField(f => ({ ...f, item_type: e.target.value as SchemaField["item_type"] }))}>
                    <option value="object">object — define item fields below ↓</option>
                    <option value="string">string — array of plain strings</option>
                    <option value="number">number — array of numbers</option>
                    <option value="boolean">boolean — array of booleans</option>
                  </select>
                </Field>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0 12px", alignItems: "center", marginTop: 4 }}>
                <Field label="Description (optional)">
                  <input style={inputStyle} value={newField.description ?? ""} onChange={e => setNewField(f => ({ ...f, description: e.target.value }))} placeholder="Human-readable description" />
                </Field>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap", paddingTop: 18, cursor: "pointer" }}>
                  <input type="checkbox" checked={newField.nullable ?? false} onChange={e => setNewField(f => ({ ...f, nullable: e.target.checked }))} />
                  Nullable
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── FieldRow — renders one field + inline edit + children ─────────────────────

interface RowProps {
  field: SchemaField;
  depth: number;
  parentPath: string;
  readOnly: boolean;
  onRemove: () => void;
  onUpdate: (updated: SchemaField) => void;
  onChildrenChange: (children: SchemaField[]) => void;
}

function FieldRow({ field, depth, parentPath, readOnly, onRemove, onUpdate, onChildrenChange }: RowProps) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Partial<SchemaField>>({});

  const fullPath = parentPath ? `${parentPath}.${field.field_path}` : field.field_path;
  const isObject = field.type === "object";
  const isArray  = field.type === "array";
  const isPrimitiveArray = isArray && field.item_type && field.item_type !== "object";
  const hasChildren = (isObject || (isArray && !isPrimitiveArray)) && field.item_schema !== undefined;

  const typeColor = TYPE_COLORS[field.type] ?? C.muted;

  function startEdit() {
    setEditValues({
      field_path:  field.field_path,
      type:        field.type,
      item_type:   field.item_type ?? "object",
      nullable:    field.nullable,
      description: field.description,
    });
    setEditing(true);
  }

  function cancelEdit() { setEditing(false); setEditValues({}); }

  function saveEdit() {
    const newType      = editValues.type ?? field.type;
    const wasComplex   = field.type === "object" || field.type === "array";
    const nowComplex   = newType === "object" || newType === "array";
    const newItemType  = newType === "array" ? (editValues.item_type ?? "object") : undefined;
    const hasChildren  = newType === "object" || (newType === "array" && newItemType === "object");

    const updated: SchemaField = {
      ...field,
      field_path:  (editValues.field_path ?? field.field_path).trim(),
      type:        newType,
      item_type:   newItemType,
      nullable:    editValues.nullable ?? field.nullable,
      description: editValues.description ?? field.description,
      // Preserve item_schema if still complex, clear if going to primitive
      item_schema: hasChildren
        ? (wasComplex && nowComplex ? field.item_schema ?? [] : [])
        : undefined,
    };
    onUpdate(updated);
    setEditing(false);
    setEditValues({});
  }

  if (editing) {
    const editType = editValues.type ?? field.type;
    const showItemType = editType === "array";
    return (
      <div style={{ marginBottom: 5, padding: 10, background: "var(--warning-background)", borderRadius: C.radius, border: `1px solid var(--warning)` }}>
        <div style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600, marginBottom: 8 }}>Editing: <code>{fullPath}</code></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: "0 8px" }}>
          <Field label="Field Name">
            <input style={inputStyle} autoFocus value={editValues.field_path ?? field.field_path}
              onChange={e => setEditValues(v => ({ ...v, field_path: e.target.value }))} />
          </Field>
          <Field label="Type">
            <select style={inputStyle} value={editType} onChange={e => setEditValues(v => ({ ...v, type: e.target.value as SchemaField["type"] }))}>
              {["string","number","boolean","object","array","null"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        {showItemType && (
          <Field label="Array Item Type">
            <select style={inputStyle} value={editValues.item_type ?? field.item_type ?? "object"} onChange={e => setEditValues(v => ({ ...v, item_type: e.target.value as SchemaField["item_type"] }))}>
              <option value="object">object — define item fields below ↓</option>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
          </Field>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0 12px", alignItems: "center" }}>
          <Field label="Description">
            <input style={inputStyle} value={editValues.description ?? field.description ?? ""} onChange={e => setEditValues(v => ({ ...v, description: e.target.value }))} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, paddingTop: 18, cursor: "pointer" }}>
            <input type="checkbox" checked={editValues.nullable ?? field.nullable} onChange={e => setEditValues(v => ({ ...v, nullable: e.target.checked }))} />
            Nullable
          </label>
        </div>
        {(editType !== field.type) && (field.type === "object" || field.type === "array") && (editType !== "object" && editType !== "array") && (
          <div style={{ fontSize: 11, color: C.danger, marginTop: 4 }}>
            ⚠ Changing type will remove all child fields defined under this field.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Btn size="sm" onClick={saveEdit}>Save</Btn>
          <Btn size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
        background: depth === 0 ? C.bg : C.surface,
        borderRadius: C.radius, border: `1px solid ${C.border}`,
      }}>
        {(hasChildren || isPrimitiveArray) ? (
          <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: C.muted, padding: 0, width: 14, flexShrink: 0 }}>
            {open ? "▼" : "▶"}
          </button>
        ) : <span style={{ width: 14, flexShrink: 0 }} />}

        <code style={{ fontSize: 11, color: C.primary, fontWeight: 600, flexShrink: 0 }}>{field.field_path}</code>

        <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 99, background: typeColor + "18", color: typeColor, flexShrink: 0 }}>
          {isPrimitiveArray ? `array of ${field.item_type}` : field.type}
        </span>

        {field.nullable && <span style={{ fontSize: 10, color: C.warning, flexShrink: 0 }}>nullable</span>}

        {field.description && (
          <span style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {field.description}
          </span>
        )}
        {!field.description && <span style={{ flex: 1 }} />}

        {!readOnly && (
          <>
            <button onClick={startEdit} title="Edit this field" style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 13, padding: "0 2px", flexShrink: 0 }}>✎</button>
            <button onClick={onRemove} title="Remove this field" style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: 14, padding: "0 2px", flexShrink: 0 }}>×</button>
          </>
        )}
      </div>

      {open && hasChildren && (
        <div style={{ marginTop: 3, marginLeft: 14 }}>
          <div style={{ fontSize: 10, color: C.muted, padding: "1px 0 3px 10px", fontStyle: "italic" }}>
            {isObject ? "properties:" : "items: (each element is an object)"}
          </div>
          <SchemaFieldTree
            fields={field.item_schema ?? []}
            onChange={onChildrenChange}
            readOnly={readOnly}
            depth={depth + 1}
            parentPath={fullPath}
          />
        </div>
      )}

      {open && isPrimitiveArray && (
        <div style={{ marginLeft: 22, marginTop: 2 }}>
          <span style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>
            Each element is a <strong>{field.item_type}</strong>. No sub-fields needed.
          </span>
        </div>
      )}
    </div>
  );
}
