import { JSONPath } from "jsonpath-plus";
import type { NormalisedPrincipal } from "../auth/oidcValidate.js";

export interface IFormEncoding { nested: string; array: string; boolean: string; null: string; }
export interface IBodyMapping {
  upstream_path: string; mapping_type: string; source?: string;
  input_path?: string; query_param?: string; path_param?: string;
  claim?: string; static_value?: string; item_mappings?: IBodyMapping[];
}

function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".").filter(Boolean);
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

function resolveValue(
  mapping: IBodyMapping,
  requestBody: unknown,
  queryParams: Record<string, string>,
  pathParams: Record<string, string>,
  principal: NormalisedPrincipal | null
): unknown {
  switch (mapping.mapping_type) {
    case "static":
      return mapping.static_value ?? null;
    case "principal":
      if (!principal) return null;
      if (mapping.claim === "sub") return principal.sub;
      if (mapping.claim === "email") return principal.email;
      return null;
    case "direct": {
      const src = mapping.source ?? "input";
      if (src === "input" && mapping.input_path) return queryOne(requestBody, mapping.input_path);
      if (src === "query" && mapping.query_param) return queryParams[mapping.query_param] ?? null;
      if (src === "path" && mapping.path_param) return pathParams[mapping.path_param] ?? null;
      return null;
    }
    default:
      return null;
  }
}

function buildObject(
  mappings: IBodyMapping[],
  requestBody: unknown,
  queryParams: Record<string, string>,
  pathParams: Record<string, string>,
  principal: NormalisedPrincipal | null
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (mapping.mapping_type === "array") {
      const src = mapping.source ?? "input";
      let sourceArray: unknown[] = [];
      if (src === "input" && mapping.input_path) {
        const result = JSONPath({ path: mapping.input_path, json: requestBody as object, wrap: true }) as unknown[];
        sourceArray = Array.isArray(result[0]) ? (result[0] as unknown[]) : [];
      }

      const outputArray = sourceArray.map((element) => {
        return buildObject(mapping.item_mappings ?? [], element, queryParams, pathParams, principal);
      });

      setByPath(output, mapping.upstream_path, outputArray);
    } else {
      const value = resolveValue(mapping, requestBody, queryParams, pathParams, principal);
      setByPath(output, mapping.upstream_path, value);
    }
  }

  return output;
}

function pctEncode(str: string): string {
  return encodeURIComponent(String(str));
}

function flattenForForm(
  obj: Record<string, unknown>,
  encoding: IFormEncoding,
  prefix = ""
): string[] {
  const parts: string[] = [];

  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? (encoding.nested === "dot" ? `${prefix}.${k}` : `${prefix}[${k}]`) : k;

    if (v === null || v === undefined) {
      if (encoding.null === "empty") parts.push(`${pctEncode(key)}=`);
    } else if (typeof v === "boolean") {
      const boolStr = encoding.boolean === "one_zero" ? (v ? "1" : "0") : (v ? "true" : "false");
      parts.push(`${pctEncode(key)}=${pctEncode(boolStr)}`);
    } else if (Array.isArray(v)) {
      v.forEach((item, idx) => {
        let arrKey = key;
        if (encoding.array === "bracket") arrKey = `${key}[]`;
        else if (encoding.array === "indexed") arrKey = `${key}[${idx}]`;
        else if (encoding.array === "comma") {
          if (idx === 0) parts.push(`${pctEncode(key)}=${v.map((i) => pctEncode(String(i ?? ""))).join(",")}`);
          return;
        }
        if (typeof item === "object" && item !== null) {
          parts.push(...flattenForForm(item as Record<string, unknown>, encoding, arrKey));
        } else {
          parts.push(`${pctEncode(arrKey)}=${pctEncode(String(item ?? ""))}`);
        }
      });
    } else if (typeof v === "object") {
      if (encoding.nested === "reject") {
        throw new Error(`form_encoding.nested = "reject" but encountered nested object at key "${key}"`);
      }
      parts.push(...flattenForForm(v as Record<string, unknown>, encoding, key));
    } else {
      parts.push(`${pctEncode(key)}=${pctEncode(String(v))}`);
    }
  }

  return parts;
}

export function buildBody(
  bodyMappings: IBodyMapping[],
  bodyContentType: string,
  bodyPassthrough: boolean,
  formEncoding: IFormEncoding,
  requestBody: unknown,
  queryParams: Record<string, string>,
  pathParams: Record<string, string>,
  principal: NormalisedPrincipal | null
): { body: string | null; contentType: string } {
  if (bodyPassthrough) {
    if (bodyContentType === "application/json") {
      return { body: JSON.stringify(requestBody), contentType: bodyContentType };
    }
    return { body: String(requestBody ?? ""), contentType: bodyContentType };
  }

  if (!bodyMappings || bodyMappings.length === 0) return { body: null, contentType: bodyContentType };

  const output = buildObject(bodyMappings, requestBody, queryParams, pathParams, principal);

  if (bodyContentType === "application/json") {
    return { body: JSON.stringify(output), contentType: "application/json" };
  }

  const parts = flattenForForm(output, formEncoding);
  return { body: parts.join("&"), contentType: "application/x-www-form-urlencoded" };
}
