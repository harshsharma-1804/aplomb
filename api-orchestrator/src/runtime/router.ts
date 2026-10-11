import { Router, type Request, type Response } from "express";
import { getDb } from "../db/client.js";
import { endpointRepo } from "../db/repos/endpointRepo.js";
import { scriptRepo } from "../db/repos/scriptRepo.js";
import { config } from "../config/appConfig.js";
import { getAppByPath } from "../cache/appCache.js";
import { getProviderByIssuer } from "../cache/providerCache.js";
import { validateToken, readIssuerFromToken, readAudienceFromToken } from "../auth/oidcValidate.js";
import { validateInput } from "./inputValidator.js";
import { applyTransform } from "./transform.js";
import { buildBody } from "./bodyBuilder.js";
import { callUpstream } from "./upstream.js";
import { writeLog, hashSub, type RequestLogEntry } from "./logger.js";
import { resolveSecret } from "../secrets/resolver.js";
import { isHostAllowedForOrg } from "../cache/allowlistCache.js";
import { buildContext } from "./ctxBuilder.js";
import { runScript } from "./scriptRunner.js";
import { handleAppAuthRoute, resolveSessionForRequest, RESERVED_APP_AUTH_PATHS } from "../auth/appSessionAuth.js";
import { handleAppOAuthRoute } from "../auth/oauthBroker.js";
import { handleAppSignupRoute } from "../auth/appSignup.js";
import { handleAppTwoFactorRoute } from "../auth/appTwoFactor.js";
import { verify as argon2Verify } from "@node-rs/argon2";
import { callDbUpstream, resolveQueryTemplate } from "./dbUpstream.js";

export async function resolveEnvVars(template: string, app: any): Promise<string> {
  const matches = template.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return template;

  let result = template;
  for (const match of matches) {
    const key = match.slice(2, -2).trim();
    const envVar = (app.app_env ?? []).find((e: any) => e.key === key);
    if (!envVar) {
      console.warn(`[env] App "${app.name}": no env var found for key "{{${key}}}" — leaving as-is`);
      continue;
    }
    if (envVar.value_type === "plain") {
      result = result.replaceAll(match, envVar.plain_value ?? "");
    } else if (envVar.value_type === "secret" && envVar.secret_id) {
      const plaintext = resolveSecret(String(envVar.secret_id));
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

  if (app.status === "draft") {
    res.status(404).json({ error: "No app matches this path", code: "APP_NOT_FOUND" });
    return;
  }

  const authHeader = req.headers["authorization"];

  let principal: import("../auth/oidcValidate.js").NormalisedPrincipal | null = null;

  const relativePath = requestPath.slice(app.base_path.length) || "/";
  const appId = String((app as any).id ?? (app as any)._id);

  // ── Frontend key enforcement ──────────────────────────────────────────────────
  // When the app has a frontend_key_hash set, every request to user-facing auth
  // routes (/login, /signup, /auth/login/*, /__2fa/*, /session/verify) must carry
  // X-Frontend-Key matching the hash. This blocks unauthorised relay servers from
  // acting on behalf of users regardless of Origin/Referer headers.
  // Callback, verify, and session-bound routes (/__me, /__logout, etc.) are exempt.
  const isUserAuthRoute = (
    relativePath === "/login" ||
    relativePath === "/session/verify" ||
    relativePath === "/signup" ||
    relativePath === "/login/2fa" ||
    relativePath.startsWith("/auth/login/") ||
    relativePath.startsWith("/__2fa/enroll") ||
    relativePath.startsWith("/__2fa/confirm") ||
    relativePath.startsWith("/__2fa/resend") ||
    relativePath === "/auth/resend-verification"
  );
  if (isUserAuthRoute && app.frontend_key_hash) {
    const provided = req.headers["x-frontend-key"] as string | undefined;
    if (!provided) {
      res.status(401).json({ error: "X-Frontend-Key header is required for this app", code: "MISSING_FRONTEND_KEY" });
      return;
    }
    const valid = await argon2Verify(app.frontend_key_hash, provided).catch(() => false);
    if (!valid) {
      res.status(401).json({ error: "Invalid frontend key", code: "INVALID_FRONTEND_KEY" });
      return;
    }
  }

  // ── Reserved app-auth endpoints (login / session/verify / logout / me / devices)
  // Handled BEFORE endpoint auth — /login and /session/verify are unauthenticated.
  if (RESERVED_APP_AUTH_PATHS.has(relativePath)) {
    const handled = await handleAppAuthRoute(req, res, app, relativePath);
    if (handled) return;
  }

  // ── Brokered identity-provider login (OAuth code+PKCE) — unauthenticated ────
  // GET {base_path}/auth/login/{providerId} and /auth/callback/{providerId}
  if (relativePath.startsWith("/auth/login/") || relativePath.startsWith("/auth/callback/")) {
    const handled = await handleAppOAuthRoute(req, res, app, relativePath);
    if (handled) return;
  }

  // ── Two-factor auth (user-based TOTP / email OTP) ────────────────────────────
  if (relativePath === "/login/2fa" || relativePath.startsWith("/__2fa/")) {
    const handled = await handleAppTwoFactorRoute(req, res, app, relativePath);
    if (handled) return;
  }

  // ── Self-signup + email verification — unauthenticated ───────────────────────
  if (relativePath === "/signup" || relativePath === "/auth/verify" || relativePath === "/auth/resend-verification") {
    const handled = await handleAppSignupRoute(req, res, app, relativePath);
    if (handled) return;
  }

  // ── Authentication — auth_required is the master switch; auth_mode picks how ─
  //   No Auth (auth_required=false)      → open, no checks (dev/demo only)
  //   Required + auth_mode bearer        → OIDC bearer per request (legacy behaviour)
  //   Required + auth_mode session/both  → orc_sid cookie; bearer wins in "both" when present
  const authMode = (app as any).auth_mode ?? "bearer";
  const authRequired = app.auth_required !== false;
  const useBearer = !authRequired
    ? false
    : authMode === "bearer"
      ? true
      : authMode === "both" && !!authHeader?.startsWith("Bearer ");
  const useSession = authRequired && (authMode === "session" || (authMode === "both" && !useBearer));

  let oidcPromise: Promise<import("../auth/oidcValidate.js").NormalisedPrincipal | null> = Promise.resolve(null);

  if (useBearer) {
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

    // Read the audience claim from the token (unverified at this point — used
    // only to select the right client when multiple are registered for the same
    // issuer; the selected provider's JWKS then fully verifies the token).
    const tokenAud = readAudienceFromToken(token);
    const provider = getProviderByIssuer(issuer, tokenAud ?? undefined);
    if (!provider || !provider.is_active) {
      res.status(401).json({ error: "Unauthorized", code: "UNKNOWN_PROVIDER" });
      return;
    }

    if (app.allowed_provider_ids.length > 0) {
      const allowed = app.allowed_provider_ids.map(String);
      if (!allowed.includes(String(provider.id))) {
        res.status(401).json({ error: "Unauthorized", code: "PROVIDER_NOT_ALLOWED_FOR_APP" });
        return;
      }
    }

    oidcPromise = validateToken(token, provider as any).catch(() => {
      throw Object.assign(new Error("Unauthorized"), { _oidcFail: true });
    });
  } else if (useSession) {
    const sess = resolveSessionForRequest(req, app);
    if (!sess.ok) {
      res.status(sess.status).json({ error: sess.error, code: sess.code });
      return;
    }
    principal = sess.normalised as import("../auth/oidcValidate.js").NormalisedPrincipal;
  }

  // Endpoint lookup — synchronous SQLite read
  const allEndpoints = endpointRepo.findByAppAndMethod(getDb(), appId, method);

  // Await OIDC (endpoint lookup is already done above)
  try {
    principal = await oidcPromise;
  } catch (e: any) {
    if (e._oidcFail) {
      res.status(401).json({ error: "Unauthorized", code: "INVALID_TOKEN" });
      return;
    }
    throw e;
  }

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
    const rfcDate = new Date(app.deprecated_at).toUTCString();
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

  const scriptMode = (endpoint as any).script_mode ?? "none";
  const orgId = String((app as any).org_id ?? "");

  const scriptFileId = (endpoint as any).script_file_id ?? null;

  function resolveScript() {
    if (!scriptFileId) throw Object.assign(new Error("No script file assigned to this endpoint"), { code: "SCRIPT_LOAD_ERROR" });
    const script = scriptRepo.findById(getDb(), String(scriptFileId));
    if (!script) throw Object.assign(new Error("Assigned script file not found"), { code: "SCRIPT_LOAD_ERROR" });
    return script;
  }

  if (scriptMode === "script_full") {
    const scriptLogs: Array<{ level: string; message: string; data?: Record<string, unknown>; ts: string }> = [];
    const ctx = buildContext(app, orgId, req.body ?? {}, pathParams, queryParams, principal, scriptLogs);
    let scriptResult;
    try {
      const script = await resolveScript();
      scriptResult = await runScript(script as any, ctx, "script_full");
    } catch (e: any) {
      const statusMap: Record<string, number> = { SCRIPT_TIMEOUT: 504, SCRIPT_LOAD_ERROR: 502, SCRIPT_FETCH_HOST_NOT_ALLOWED: 403 };
      res.status(statusMap[e.code] ?? 502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR" });
      return;
    }
    if (!scriptResult || scriptResult.body === undefined) {
      res.status(502).json({ error: "Script did not return a valid response", code: "SCRIPT_INVALID_RESPONSE" });
      return;
    }
    const status = scriptResult.status ?? 200;
    if (scriptResult.headers) {
      for (const [k, v] of Object.entries(scriptResult.headers)) res.setHeader(k, v);
    }
    res.setHeader("X-Orchestrator-App", String(app.name));
    res.setHeader("X-Orchestrator-Version", app.base_path);
    res.setHeader("X-Orchestrator-Mode", (app as any).mode ?? "prod");
    let transformed: Record<string, unknown>;
    try { transformed = applyTransform(scriptResult.body, endpoint.output_schema ?? [], endpoint.field_mappings ?? []); }
    catch { transformed = scriptResult.body as Record<string, unknown>; }
    res.status(status).json(transformed);
    writeLog({ app: String(app.name), endpoint_path: endpoint.path, method, upstream_latency_ms: 0, total_latency_ms: Date.now() - startTime, status, transform_outcome: "ok", provider_issuer: principal?.issuer ?? null, sub_hash: principal ? hashSub(principal.sub) : null, request_body_size: req.headers["content-length"] ? parseInt(req.headers["content-length"]) : 0, response_body_size: Buffer.byteLength(JSON.stringify(transformed)), input_validation_result: inputValidationResult, output_warning_count: 0 });
    return;
  }

  // ── DB / GraphQL upstream branch ─────────────────────────────────────────────
  const upstreamType: string = (endpoint.upstream as any).upstream_type ?? "http";

  if (upstreamType === "mongodb" || upstreamType === "postgresql" || upstreamType === "mysql") {
    const rawDbUrl: string = (endpoint.upstream as any).db_url ?? "";
    if (!rawDbUrl) {
      res.status(500).json({ error: "Endpoint is missing a DB connection URL", code: "DB_CONNECTION_ERROR" });
      return;
    }
    const resolvedDbUrl = await resolveEnvVars(rawDbUrl, app);

    // Host allowlist — same check as HTTP upstreams
    if (!isHostAllowedForOrg(resolvedDbUrl, orgId)) {
      res.status(403).json({ error: "Upstream DB host is not in your organization's allowlist", code: "HOST_NOT_ALLOWED" });
      return;
    }

    let dbResult;
    try {
      const upstreamStart = Date.now();
      dbResult = await callDbUpstream(
        {
          upstream_type:    upstreamType as any,
          db_url:           resolvedDbUrl,
          db_collection:    (endpoint.upstream as any).db_collection,
          db_operation:     (endpoint.upstream as any).db_operation,
          db_result_limit:  (endpoint.upstream as any).db_result_limit,
          db_query_template: await resolveEnvVars((endpoint.upstream as any).db_query_template ?? "", app),
          db_query_mode:    (endpoint.upstream as any).db_query_mode,
        },
        pathParams,
        queryParams,
      );
      const upstreamLatencyDb = Date.now() - upstreamStart;

      let transformed: Record<string, unknown>;
      let transformOutcome: RequestLogEntry["transform_outcome"] = "ok";
      try {
        transformed = applyTransform(dbResult.data, endpoint.output_schema ?? [], endpoint.field_mappings ?? []);
      } catch (err: any) {
        if (err?.code === "TRANSFORM_ARRAY_PATH_ERROR") {
          res.status(502).json({ error: err.message, code: "TRANSFORM_ARRAY_PATH_ERROR" });
          return;
        }
        transformOutcome = "error";
        transformed = {};
      }

      res.setHeader("X-Orchestrator-App",     String(app.name));
      res.setHeader("X-Orchestrator-Version", app.base_path);
      res.setHeader("X-Orchestrator-Mode",    (app as any).mode ?? "prod");
      res.status(200).json(transformed);
      writeLog({
        app: String(app.name), endpoint_path: endpoint.path, method,
        upstream_latency_ms: upstreamLatencyDb, total_latency_ms: Date.now() - startTime,
        status: 200, transform_outcome: transformOutcome,
        provider_issuer: principal?.issuer ?? null,
        sub_hash: principal ? hashSub(principal.sub) : null,
        request_body_size: req.headers["content-length"] ? parseInt(req.headers["content-length"]) : 0,
        response_body_size: Buffer.byteLength(JSON.stringify(transformed)),
        input_validation_result: inputValidationResult, output_warning_count: 0,
      });
      return;
    } catch (err: any) {
      const statusMap: Record<string, number> = {
        DB_CONNECTION_ERROR:      503,
        DB_TEMPLATE_PARSE_ERROR:  400,
        DB_TEMPLATE_PARAM_MISSING: 400,
        DB_OPERATION_NOT_ALLOWED: 400,
        DB_QUERY_ERROR:           400,
        DB_RESULT_PARSE_ERROR:    502,
      };
      const code = err?.code ?? "DB_CONNECTION_ERROR";
      res.status(statusMap[code] ?? 503).json({ error: err.message, code });
      return;
    }
  }

  if (upstreamType === "graphql") {
    // GraphQL: validate body, call as HTTP POST, feed result through transform
    if (!req.body?.query || typeof req.body.query !== "string") {
      res.status(400).json({ error: "GraphQL requests must include a 'query' field in the request body", code: "VALIDATION_ERROR" });
      return;
    }
  }

  // ── HTTP / GraphQL HTTP path ──────────────────────────────────────────────

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

  const urlTemplate = await resolveEnvVars(endpoint.upstream.url, app);
  const resolvedUrl = substitutePathParams(
    urlTemplate + (upstreamQuery.toString() ? "?" + upstreamQuery.toString() : ""),
    pathParams
  );

  if (!isHostAllowedForOrg(resolvedUrl, orgId)) {
    res.status(403).json({ error: "Upstream host is not in your organization's allowlist", code: "HOST_NOT_ALLOWED" });
    return;
  }

  const upstreamHeaders: Record<string, string> = {};

  // Step 1 — static headers; resolve {{VAR}} in values — parallel
  await Promise.all(
    (endpoint.upstream.static_headers ?? []).map(async (sh: any) => {
      if (sh.name) {
        upstreamHeaders[sh.name] = await resolveEnvVars(sh.value ?? "", app);
      }
    })
  );

  // Step 1.5 — forward ALL safe incoming headers when forward_all_headers is enabled
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

  // Step 2 — forwarded headers from the frontend request
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
      continue;
    }
    const targetName = fh.to_name?.trim() || fh.from_name;
    upstreamHeaders[targetName] = incomingValue;
  }

  // Step 3 — auth / cookie forwarding (highest precedence)
  if (endpoint.upstream.forward_cookies || endpoint.upstream.auth_type === "forward_cookie") {
    if (authHeader) upstreamHeaders["Authorization"] = authHeader;
    const cookie = req.headers["cookie"];
    if (cookie) upstreamHeaders["Cookie"] = cookie;
  }

  const idempotencyKey = req.headers["idempotency-key"] as string | undefined ?? null;

  const scriptLogs: Array<{ level: string; message: string; data?: Record<string, unknown>; ts: string }> = [];

  if (scriptMode === "script_pre" || scriptMode === "script_pre_post") {
    const ctx = buildContext(app, orgId, req.body ?? {}, pathParams, queryParams, principal, scriptLogs);
    try {
      const script = await resolveScript();
      const earlyReturn = await runScript(script as any, ctx, "script_pre");
      if (earlyReturn) {
        if (earlyReturn.headers) for (const [k, v] of Object.entries(earlyReturn.headers)) res.setHeader(k, v);
        res.setHeader("X-Orchestrator-App", String(app.name));
        res.setHeader("X-Orchestrator-Version", app.base_path);
        res.setHeader("X-Orchestrator-Mode", (app as any).mode ?? "prod");
        let transformed: Record<string, unknown>;
        try { transformed = applyTransform(earlyReturn.body, endpoint.output_schema ?? [], endpoint.field_mappings ?? []); }
        catch { transformed = earlyReturn.body as Record<string, unknown>; }
        res.status(earlyReturn.status ?? 200).json(transformed);
        return;
      }
      if (ctx.upstreamOverrides.url) Object.assign(upstreamHeaders, ctx.upstreamOverrides.headers ?? {});
    } catch (e: any) {
      const statusMap: Record<string, number> = { SCRIPT_TIMEOUT: 504, SCRIPT_LOAD_ERROR: 502, SCRIPT_FETCH_HOST_NOT_ALLOWED: 403 };
      res.status(statusMap[e.code] ?? 502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR" });
      return;
    }
  }

  let upstreamResult;
  let upstreamLatency = 0;
  try {
    const upstreamStart = Date.now();
    // GraphQL: always POST, always JSON, body is the GQL query+variables
    const effectiveMethod = upstreamType === "graphql" ? "POST" : endpoint.upstream.method;
    const effectiveBody   = upstreamType === "graphql"
      ? JSON.stringify({ query: req.body.query, variables: req.body.variables ?? null })
      : upstreamBody;

    upstreamResult = await callUpstream(
      endpoint as any,
      resolvedUrl,
      effectiveMethod,
      upstreamHeaders,
      effectiveBody,
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

  // Parse upstream body regardless of status code
  let upstreamJson: unknown;
  try {
    upstreamJson = JSON.parse(upstreamResult.body);
  } catch {
    upstreamJson = upstreamResult.body;
  }

  // If upstream returned an error status and no post-hook is active — pass through as-is
  if (upstreamResult.status >= 400 && scriptMode !== "script_post" && scriptMode !== "script_pre_post") {
    res.status(upstreamResult.status).json(upstreamJson);
    return;
  }

  if (scriptMode === "script_post" || scriptMode === "script_pre_post") {
    const ctx = buildContext(app, orgId, req.body ?? {}, pathParams, queryParams, principal, scriptLogs);
    // Pass upstream as { status, body, headers } so the postHook can inspect
    // the HTTP status code and decide whether to handle errors or pass them through.
    const upstreamArg = {
      status: upstreamResult.status,
      body:   upstreamJson,
      headers: upstreamResult.headers ?? {},
    };
    try {
      const script = await resolveScript();
      const postResult = await runScript(script as any, ctx, scriptMode === "script_post" ? "script_post" : "script_pre_post", upstreamArg);
      if (postResult) {
        const finalStatus = postResult.status ?? upstreamResult.status;
        if (postResult.headers) {
          for (const [k, v] of Object.entries(postResult.headers)) res.setHeader(k, v);
        }
        res.setHeader("X-Orchestrator-App", String(app.name));
        res.setHeader("X-Orchestrator-Version", app.base_path);
        res.setHeader("X-Orchestrator-Mode", (app as any).mode ?? "prod");
        let transformed: Record<string, unknown>;
        try { transformed = applyTransform(postResult.body, endpoint.output_schema ?? [], endpoint.field_mappings ?? []); }
        catch { transformed = postResult.body as Record<string, unknown>; }
        res.status(finalStatus).json(transformed);
        writeLog({ app: String(app.name), endpoint_path: endpoint.path, method, upstream_latency_ms: upstreamLatency, total_latency_ms: Date.now() - startTime, status: finalStatus, transform_outcome: "ok", provider_issuer: principal?.issuer ?? null, sub_hash: principal ? hashSub(principal.sub) : null, request_body_size: req.headers["content-length"] ? parseInt(req.headers["content-length"]) : 0, response_body_size: Buffer.byteLength(JSON.stringify(transformed)), input_validation_result: inputValidationResult, output_warning_count: 0 });
        return;
      }
      // Post-hook returned nothing — if upstream was an error, pass it through now
      if (upstreamResult.status >= 400) {
        res.status(upstreamResult.status).json(upstreamJson);
        return;
      }
    } catch (e: any) {
      const statusMap: Record<string, number> = { SCRIPT_TIMEOUT: 504, SCRIPT_LOAD_ERROR: 502, SCRIPT_FETCH_HOST_NOT_ALLOWED: 403 };
      res.status(statusMap[e.code] ?? 502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR" });
      return;
    }
  }

  // If upstream errored and we reach here without a post-hook handling it, pass through
  if (upstreamResult.status >= 400) {
    res.status(upstreamResult.status).json(upstreamJson);
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
