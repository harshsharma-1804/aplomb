import { useState } from "react";
import type { SchemaField } from "../../../api/types";
import { C } from "../../../components";

function schemaToExample(fields: SchemaField[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of [...fields].sort((a, b) => a.sort_order - b.sort_order)) {
    switch (field.type) {
      case "string":
        result[field.field_path] = "string";
        break;
      case "number":
        result[field.field_path] = 0;
        break;
      case "boolean":
        result[field.field_path] = true;
        break;
      case "null":
        result[field.field_path] = null;
        break;
      case "object":
        result[field.field_path] = field.item_schema?.length
          ? schemaToExample(field.item_schema)
          : {};
        break;
      case "array": {
        if (!field.item_schema?.length) {
          const itemVal =
            field.item_type === "number" ? 0
            : field.item_type === "boolean" ? true
            : "string";
          result[field.field_path] = [itemVal];
        } else {
          result[field.field_path] = [schemaToExample(field.item_schema)];
        }
        break;
      }
    }
  }
  return result;
}

interface Props {
  schema: SchemaField[];
  label?: string;
}

export function SchemaBodyPreview({ schema, label }: Props) {
  const [mode, setMode] = useState<"definition" | "preview">("definition");

  const pillBtn = (key: "definition" | "preview", text: string) => (
    <button
      onClick={() => setMode(key)}
      style={{
        padding: "3px 12px",
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${mode === key ? C.primary : C.border}`,
        borderRadius: 99,
        cursor: "pointer",
        background: mode === key ? C.selection : C.surface,
        color: mode === key ? C.primary : C.muted,
        lineHeight: 1.6,
      }}
    >
      {text}
    </button>
  );

  const displayData =
    mode === "preview"
      ? (schema.length > 0 ? schemaToExample(schema) : {})
      : schema;

  const isEmpty = schema.length === 0;

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4 }}>
      {/* Toggle header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px",
        background: C.bg,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: ".3px" }}>
          {label ?? "RAW JSON"}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {pillBtn("definition", "Schema Definition")}
          {pillBtn("preview",    "Body Preview")}
        </div>
      </div>

      {/* JSON display */}
      <div style={{ padding: "10px 16px 14px" }}>
        {isEmpty ? (
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
            {mode === "preview"
              ? "No fields defined yet — add fields to see an example body."
              : "Schema is empty."}
          </p>
        ) : (
          <>
            {mode === "preview" && (
              <p style={{ fontSize: 11, color: C.muted, margin: "0 0 6px", fontStyle: "italic" }}>
                Example body synthesized from your schema — values are placeholders showing the expected type.
              </p>
            )}
            <pre style={{
              margin: 0,
              padding: "10px 14px",
              background: "var(--code-bg)",
              color: "var(--code-text)",
              borderRadius: C.radius,
              fontSize: 12,
              fontFamily: "monospace",
              overflowX: "auto",
              lineHeight: 1.6,
              maxHeight: 340,
              overflowY: "auto",
            }}>
              {JSON.stringify(displayData, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
