import type { ISchemaField } from "../models/Endpoint.js";

export interface ValidationError {
  field_path: string;
  message: string;
}

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce((cur: unknown, key) => {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

function validateField(
  value: unknown,
  field: ISchemaField,
  parentPath: string,
  errors: ValidationError[]
): void {
  const fullPath = parentPath ? `${parentPath}.${field.field_path}` : field.field_path;

  if (value === undefined || value === null) {
    if (!field.nullable) {
      errors.push({ field_path: fullPath, message: `Required field is missing or null` });
    }
    return;
  }

  if (field.type === "array") {
    if (!Array.isArray(value)) {
      errors.push({ field_path: fullPath, message: `Expected array, got ${typeof value}` });
      return;
    }
    if (field.item_schema && field.item_schema.length > 0) {
      value.forEach((item, idx) => {
        field.item_schema!.forEach((itemField) => {
          const itemValue = getByPath(item, itemField.field_path);
          validateField(itemValue, itemField, `${fullPath}[${idx}]`, errors);
        });
      });
    }
    return;
  }

  if (field.type === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      errors.push({ field_path: fullPath, message: `Expected object, got ${typeof value}` });
      return;
    }
    if (field.item_schema && field.item_schema.length > 0) {
      field.item_schema.forEach(childField => {
        const childValue = getByPath(value, childField.field_path);
        validateField(childValue, childField, fullPath, errors);
      });
    }
    return;
  }

  const typeMap: Record<string, string> = {
    string: "string", number: "number", boolean: "boolean",
  };
  const expected = typeMap[field.type];
  if (expected && typeof value !== expected) {
    errors.push({ field_path: fullPath, message: `Expected ${field.type}, got ${typeof value}` });
  }
}

export function validateInput(
  body: unknown,
  inputSchema: ISchemaField[],
  validation: "strict" | "permissive"
): { valid: boolean; errors: ValidationError[] } {
  if (!inputSchema || inputSchema.length === 0) return { valid: true, errors: [] };

  const errors: ValidationError[] = [];

  for (const field of inputSchema) {
    const value = getByPath(body, field.field_path);
    validateField(value, field, "", errors);
  }

  return {
    valid: validation === "permissive" || errors.length === 0,
    errors,
  };
}
