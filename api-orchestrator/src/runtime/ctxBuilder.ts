import { isHostAllowedForOrg } from "../cache/allowlistCache.js";
import { getAppByPath } from "../cache/appCache.js";
import { Endpoint } from "../models/Endpoint.js";
import { resolveEnvVars } from "./router.js";
import { applyTransform } from "./transform.js";
import { callUpstream } from "./upstream.js";
import type { IApp } from "../models/App.js";
import type { NormalisedPrincipal } from "../auth/oidcValidate.js";

export interface HandlerResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface EndpointContext {
  request: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
  principal: NormalisedPrincipal | null;
  env: Record<string, string>;
  upstreamOverrides: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  fetch: typeof globalThis.fetch;
  call: (
    appBasePath: string,
    endpointPath: string,
    options?: { method?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> }
  ) => Promise<unknown>;
  logger: {
    info: (message: string, data?: Record<string, unknown>) => void;
    warn: (message: string, data?: Record<string, unknown>) => void;
    error: (message: string, data?: Record<string, unknown>) => void;
  };
}

export function buildContext(
  app: IApp,
  orgId: string,
  requestBody: Record<string, unknown>,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
  principal: NormalisedPrincipal | null,
  scriptLogs: Array<{ level: string; message: string; data?: Record<string, unknown>; ts: string }>
): EndpointContext {
  const env: Record<string, string> = {};
  for (const v of app.app_env ?? []) {
    if (v.value_type === "plain" && v.plain_value !== undefined) {
      env[v.key] = v.plain_value;
    }
  }

  const guardedFetch: typeof globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (!isHostAllowedForOrg(url, orgId)) {
      return Promise.reject(Object.assign(new Error(`fetch() target host is not in your allowlist: ${url}`), { code: "SCRIPT_FETCH_HOST_NOT_ALLOWED" }));
    }
    return globalThis.fetch(input as any, init);
  };

  const internalCall = async (
    appBasePath: string,
    endpointPath: string,
    options: { method?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}
  ): Promise<unknown> => {
    const targetApp = getAppByPath(appBasePath);
    if (!targetApp) throw Object.assign(new Error(`ctx.call: no app found for base path "${appBasePath}"`), { code: "SCRIPT_CALL_NOT_FOUND" });

    const method = (options.method ?? "GET").toUpperCase();
    const allEndpoints = await Endpoint.find({ app_id: targetApp._id, method }).lean();

    let targetEndpoint = null;
    let innerPathParams: Record<string, string> = {};

    for (const ep of allEndpoints) {
      const patternParts = ep.path.split("/");
      const actualParts = endpointPath.split("/");
      if (patternParts.length !== actualParts.length) continue;
      const params: Record<string, string> = {};
      let match = true;
      for (let i = 0; i < patternParts.length; i++) {
        const pp = patternParts[i]!;
        const ap = actualParts[i]!;
        if (pp.startsWith("{") && pp.endsWith("}")) {
          params[pp.slice(1, -1)] = decodeURIComponent(ap);
        } else if (pp !== ap) {
          match = false; break;
        }
      }
      if (match) { targetEndpoint = ep; innerPathParams = params; break; }
    }

    if (!targetEndpoint) throw Object.assign(new Error(`ctx.call: no endpoint found for ${method} ${endpointPath} in app "${appBasePath}"`), { code: "SCRIPT_CALL_NOT_FOUND" });

    const innerQuery = new URLSearchParams();
    for (const qp of targetEndpoint.query_params ?? []) {
      const val = (options.query ?? {})[qp.frontend_param] ?? qp.default_value;
      if (val !== undefined) innerQuery.set(qp.upstream_param, val);
    }

    const urlTemplate = await resolveEnvVars(targetEndpoint.upstream.url, targetApp as unknown as IApp);
    const resolvedUrl = urlTemplate.replace(/\{([^}]+)\}/g, (m, name) => {
      const v = innerPathParams[name] ?? innerPathParams[name.toLowerCase()];
      return v !== undefined ? encodeURIComponent(v) : m;
    }) + (innerQuery.toString() ? "?" + innerQuery.toString() : "");

    const upstreamResult = await callUpstream(
      targetEndpoint as any,
      resolvedUrl,
      targetEndpoint.upstream.method,
      {},
      options.body ? JSON.stringify(options.body) : null,
      null
    );

    let upstreamJson: unknown;
    try { upstreamJson = JSON.parse(upstreamResult.body); } catch { upstreamJson = upstreamResult.body; }

    try {
      return applyTransform(upstreamJson, (targetEndpoint as any).output_schema ?? [], (targetEndpoint as any).field_mappings ?? []);
    } catch {
      return upstreamJson;
    }
  };

  return {
    request: requestBody,
    params: pathParams,
    query: queryParams,
    principal,
    env,
    upstreamOverrides: {},
    fetch: guardedFetch,
    call: internalCall,
    logger: {
      info:  (message, data) => { console.info(`[script:info] ${message}`, data ?? ""); scriptLogs.push({ level: "info", message, data, ts: new Date().toISOString() }); },
      warn:  (message, data) => { console.warn(`[script:warn] ${message}`, data ?? ""); scriptLogs.push({ level: "warn", message, data, ts: new Date().toISOString() }); },
      error: (message, data) => { console.error(`[script:error] ${message}`, data ?? ""); scriptLogs.push({ level: "error", message, data, ts: new Date().toISOString() }); },
    },
  };
}
