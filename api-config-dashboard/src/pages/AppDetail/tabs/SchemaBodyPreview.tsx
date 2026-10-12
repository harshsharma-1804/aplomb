import { useState } from "react";
import type { SchemaField } from "../../../api/types";
import { Card, Code } from "../../../components";

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
  const [mode, setMode] = useState<"definition" | "preview">("preview");

  const displayData =
    mode === "preview"
      ? (schema.length > 0 ? schemaToExample(schema) : {})
      : schema;

  return <Card><div className="ui-card__head"><h2 className="ui-card__title">{label?.startsWith("REQUEST") ? "Request body" : "Response body"}</h2><div className="ui-seg" data-nosave><button className={`ui-seg__item ${mode==="definition" ? "is-active" : ""}`} onClick={()=>setMode("definition")}>Schema definition</button><button className={`ui-seg__item ${mode==="preview" ? "is-active" : ""}`} onClick={()=>setMode("preview")}>Body preview</button></div></div><div className="ui-card__body">{mode==="preview" && <p className="ui-hint" style={{marginBottom:10}}>Example body synthesized from your schema. Values are placeholders showing the expected type.</p>}<Code value={displayData}/></div></Card>;
}
