import { Router, type Request, type Response } from "express";
import { Endpoint } from "../models/Endpoint.js";
import { config } from "../config/appConfig.js";
import { getAppByPath } from "../cache/appCache.js";
import { getProviderByIssuer } from "../cache/providerCache.js";
import { validateToken, readIssuerFromToken } from "../auth/oidcValidate.js";
import { validateInput } from "./inputValidator.js";
import { applyTransform } from "./transform.js";
import { buildBody } from "./bodyBuilder.js";
import { callUpstream } from "./upstream.js";
import { writeLog, hashSub, type RequestLogEntry } from "./logger.js";
import { resolveSecret } from "../secrets/resolver.js";
import { isHostAllowedForOrg } from "../cache/allowlistCache.js";
import type { IApp } from "../models/App.js";

/**
 * Resolves {{KEY}} template references in a string using the app's environment variables.
 * Plain values are substituted directly.
 * Secret values are resolved from the secrets store (plaintext in memory only).
 * Unknown keys are left as-is with a warning.
 */
export async function resolveEnvVars(template: string, app: IApp): Promise<string> {
  const matches = template.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return template;

  let result = template;
  for (const match of matches) {
    const key = match.slice(2, -2).trim();
    const envVar = (app.app_env ?? []).find((e) => e.key === key);
    if (!envVar) {
      console.warn(`[env] App "${app.name}": no env var found for key "{{${key}}}" — leaving as-is`);
      continue;
    }
    if (envVar.value_type === "plain") {
      result = result.replaceAll(match, envVar.plain_value ?? "");
    } else if (envVar.value_type === "secret" && envVar.secret_id) {
      const plaintext = await resolveSecret(envVar.secret_id);
      result = result.replaceAll(match, plaintext);
    }
  }
  return result;
}

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
];

function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(hostname));
}

function isHostAllowed(url: string): boolean {
  const allowlist = config.upstream.hostAllowlist;
  if (allowlist.length === 0) return true;

  let hostname: string;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (config.upstream.blockPrivateRanges && isPrivateHost(hostname)) {
    return allowlist.some((a) => {
      if (a.startsWith("*.")) { const d = a.slice(2); return hostname === d || hostname.endsWith("." + d); }
      return hostname === a;
    });
  }

  for (const allowed of allowlist) {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      if (hostname === domain || hostname.endsWith("." + domain)) return true;
    } else if (hostname === allowed) return true;
  }

  return false;
}

function resolvePathParams(
  pattern: string,
  actualPath: string
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const actualParts = actualPath.split("/");
  if (patternParts.length !== actualParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const ap = actualParts[i]!;
    if (pp.startsWith("{") && pp.endsWith("}")) {
      params[pp.slice(1, -1)] = decodeURIComponent(ap);
    } else if (pp !== ap) {
      return null;
    }
  }
  return params;
}

/**
 * Substitutes {paramName} placeholders in a URL.
 * Case-insensitive match: {claimId} in URL matches "claimid" in params and vice-versa.
 * Non-destructive: if a param is not found the placeholder is left unchanged
 * (not replaced with an empty string) so it is visible for debugging.
 */
function substitutePathParams(url: string, params: Record<string, string>): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) lower[k.toLowerCase()] = v;
  return url.replace(/\{([^}]+)\}/g, (match, name) => {
    const val = params[name] ?? lower[name.toLowerCase()];
    return val !== undefined ? encodeURIComponent(val) : match;
  });
}

export const runtimeRouter = Router();

runtimeRouter.all("/*path", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestPath = req.path;
  const method = req.method.toUpperCase();

  const app = getAppByPath(requestPath);
  if (!app) {
    res.status(404).json({ error: "No app matches this path", code: "APP_NOT_FOUND" });
    return;
  }

  // Draft apps are invisible — return the same 404 as "no app found" to avoid
  // revealing which paths exist in draft. No exceptions regardless of auth_required.
  if (app.status === "draft") {
    res.status(404).json({ error: "No app matches this path", code: "APP_NOT_FOUND" });
    return;
  }

  const authHeader = req.headers["authorization"];

  // ── OIDC validation — skipped when app.auth_required === false ─────────────
  // auth_required: false is for local dev / demo only. Never use in production.
  let principal: import("../auth/oidcValidate.js").NormalisedPrincipal | null = null;

  if (app.auth_required !== false) {
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized", code: "MISSING_TOKEN" });
      return;
    }
    const token = authHeader.slice(7).trim();

    const issuer = readIssuerFromToken(token);
    if (!issuer) {
      res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN" });
      return;
    }

    const provider = getProviderByIssuer(issuer);
    if (!provider || !provider.is_active) {
      res.status(401).json({ error: "Unauthorized", code: "UNKNOWN_PROVIDER" });
      return;
    }

    if (app.allowed_provider_ids.length > 0) {
      const allowed = app.allowed_provider_ids.map(String);
      if (!allowed.includes(String(provider._id))) {
        res.status(401).json({ error: "Unauthorized", code: "PROVIDER_NOT_ALLOWED_FOR_APP" });
        return;
      }
    }

    try {
      principal = await validateToken(token, provider);
    } catch {
      res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN" });
      return;
    }
  }

  const relativePath = requestPath.slice(app.base_path.length) || "/";

  const allEndpoints = await Endpoint.find({ app_id: app._id, method }).lean();
  let endpoint = null;
  let pathParams: Record<string, string> = {};

  for (const ep of allEndpoints) {
    const resolved = resolvePathParams(ep.path, relativePath);
    if (resolved !== null) {
      endpoint = ep;
      pathParams = resolved;
      break;
    }
  }

  if (!endpoint) {
    res.status(404).json({ error: "Endpoint not found", code: "ENDPOINT_NOT_FOUND" });
    return;
  }

  if (!endpoint.is_active) {
    res.status(503).json({ error: "Endpoint is disabled", code: "ENDPOINT_INACTIVE" });
    return;
  }

  if (app.status === "deprecated" && app.deprecated_at) {
    const rfcDate = app.deprecated_at.toUTCString();
    res.setHeader("Deprecation", rfcDate);
    res.setHeader("Sunset", rfcDate);
  }

  const requestContentType = req.headers["content-type"] ?? "";
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);

  if (hasBody && endpoint.request?.content_type) {
    if (!requestContentType.includes(endpoint.request.content_type)) {
      res.status(415).json({ error: `Unsupported Media Type — expected ${endpoint.request.content_type}`, code: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }
  }

  let inputValidationResult: RequestLogEntry["input_validation_result"] = "skipped";
  if (hasBody && endpoint.request?.input_schema?.length > 0) {
    const { valid, errors } = validateInput(req.body, endpoint.request.input_schema, endpoint.request.validation);
    if (!valid) {
      res.status(400).json({ error: "Request body validation failed", code: "VALIDATION_ERROR", errors });
      return;
    }
    inputValidationResult = "passed";
  }

  const queryParams = req.query as Record<string, string>;
  const upstreamQuery = new URLSearchParams();
  for (const qp of endpoint.query_params ?? []) {
    const val = queryParams[qp.frontend_param] ?? qp.default_value;
    if (val !== undefined) upstreamQuery.set(qp.upstream_param, val);
  }

  const { body: upstreamBody } = hasBody && !endpoint.upstream.body_passthrough
    ? buildBody(
        endpoint.upstream.body_mappings ?? [],
        endpoint.upstream.body_content_type,
        endpoint.upstream.body_passthrough,
        endpoint.upstream.form_encoding,
        req.body,
        queryParams,
        pathParams,
        principal
      )
    : { body: null };

  // ── Resolve {{VAR}} env references in URL template before path param substitution ──
  const urlTemplate = await resolveEnvVars(endpoint.upstream.url, app as unknown as IApp);
  const resolvedUrl = substitutePathParams(
    urlTemplate + (upstreamQuery.toString() ? "?" + upstreamQuery.toString() : ""),
    pathParams
  );

  const orgId = String((app as any).org_id ?? "");
  if (!isHostAllowedForOrg(resolvedUrl, orgId)) {
    res.status(403).json({ error: "Upstream host is not in your organization's allowlist", code: "HOST_NOT_ALLOWED" });
    return;
  }

  const upstreamHeaders: Record<string, string> = {};

  // Step 1 — static headers (always sent); resolve {{VAR}} in values
  for (const sh of endpoint.upstream.static_headers ?? []) {
    if (sh.name) {
      const resolvedValue = await resolveEnvVars(sh.value ?? "", app as unknown as IApp);
      upstreamHeaders[sh.name] = resolvedValue;
    }
  }

  // Step 1.5 — forward ALL safe incoming headers when forward_all_headers is enabled.
  // Individual rules in Step 2 run after and can override any header set here.
  if ((endpoint.upstream as any).forward_all_headers) {
    const HOP_BY_HOP = new Set([
      "host", "connection", "keep-alive", "transfer-encoding",
      "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate",
    ]);
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase()) && value) {
        upstreamHeaders[name] = Array.isArray(value) ? value.join(", ") : value;
      }
    }
  }

  // Step 2 — forwarded headers from the frontend request (pass-through / rename).
  // Trim from_name to handle accidental spaces entered in the dashboard.
  for (const fh of endpoint.upstream.forwarded_headers ?? []) {
    const incomingValue = req.headers[fh.from_name.trim().toLowerCase()] as string | undefined;
    if (!incomingValue) {
      if (fh.required) {
        res.status(400).json({
          error: `Required header "${fh.from_name}" is missing from the request`,
          code: "REQUIRED_HEADER_MISSING",
          header: fh.from_name,
        });
        return;
      }
      continue; // optional and absent — skip silently
    }
    const targetName = fh.to_name?.trim() || fh.from_name;
    upstreamHeaders[targetName] = incomingValue;
  }

  // Step 3 — auth / cookie forwarding (highest precedence, applied last)
  if (endpoint.upstream.forward_cookies || endpoint.upstream.auth_type === "forward_cookie") {
    if (authHeader) upstreamHeaders["Authorization"] = authHeader;
    const cookie = req.headers["cookie"];
    if (cookie) upstreamHeaders["Cookie"] = cookie;
  }

  const idempotencyKey = req.headers["idempotency-key"] as string | undefined ?? null;

  let upstreamResult;
  let upstreamLatency = 0;
  try {
    const upstreamStart = Date.now();
    upstreamResult = await callUpstream(
      endpoint as any,
      resolvedUrl,
      endpoint.upstream.method,
      upstreamHeaders,
      upstreamBody,
      idempotencyKey
    );
    upstreamLatency = Date.now() - upstreamStart;
  } catch (err: any) {
    const isArrayError = err?.code === "TRANSFORM_ARRAY_PATH_ERROR";
    res.status(isArrayError ? 502 : 503).json({
      error: isArrayError ? err.message : "Upstream call failed",
      code: isArrayError ? "TRANSFORM_ARRAY_PATH_ERROR" : "UPSTREAM_ERROR",
    });
    return;
  }

  if (upstreamResult.status >= 400) {
    let upstreamBody: unknown;
    try { upstreamBody = JSON.parse(upstreamResult.body); } catch { upstreamBody = upstreamResult.body; }
    res.status(upstreamResult.status).json(upstreamBody);
    return;
  }

  let upstreamJson: unknown;
  try {
    upstreamJson = JSON.parse(upstreamResult.body);
  } catch {
    res.status(502).json({ error: "Upstream returned non-JSON", code: "UPSTREAM_PARSE_ERROR" });
    return;
  }

  let transformed: Record<string, unknown>;
  let transformOutcome: RequestLogEntry["transform_outcome"] = "ok";
  try {
    transformed = applyTransform(upstreamJson, endpoint.output_schema ?? [], endpoint.field_mappings ?? []);
  } catch (err: any) {
    if (err?.code === "TRANSFORM_ARRAY_PATH_ERROR") {
      res.status(502).json({ error: err.message, code: "TRANSFORM_ARRAY_PATH_ERROR" });
      return;
    }
    console.error("[runtime] Transform error:", err);
    transformOutcome = "error";
    transformed = {};
  }

  res.setHeader("X-Orchestrator-App", String(app.name));
  res.setHeader("X-Orchestrator-Version", app.base_path);
  res.setHeader("X-Orchestrator-Mode", (app as any).mode ?? "prod");
  res.status(200).json(transformed);

  writeLog({
    app: String(app.name),
    endpoint_path: endpoint.path,
    method,
    upstream_latency_ms: upstreamLatency,
    total_latency_ms: Date.now() - startTime,
    status: 200,
    transform_outcome: transformOutcome,
    provider_issuer: principal?.issuer ?? null,
    sub_hash: principal ? hashSub(principal.sub) : null,
    request_body_size: req.headers["content-length"] ? parseInt(req.headers["content-length"]) : 0,
    response_body_size: Buffer.byteLength(JSON.stringify(transformed)),
    input_validation_result: inputValidationResult,
    output_warning_count: 0,
  });
});
