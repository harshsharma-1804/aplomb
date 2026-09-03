import vm from "node:vm";
import { createRequire } from "node:module";
import type { IAppScript } from "../models/AppScript.js";
import type { ScriptMode } from "../models/Endpoint.js";
import type { EndpointContext, HandlerResponse } from "./ctxBuilder.js";

const SCRIPT_TIMEOUT_MS = 30_000;

interface CacheEntry {
  exports: Record<string, unknown>;
  updatedAt: string;
}

const moduleCache = new Map<string, CacheEntry>();

function loadModule(script: IAppScript): Record<string, unknown> {
  const id = String(script._id);
  const updatedAt = (script.updated_at ?? script.created_at)?.toISOString() ?? id;
  const cacheKey = `${id}:${updatedAt}`;

  const cached = moduleCache.get(id);
  if (cached && cached.updatedAt === cacheKey) return cached.exports;

  const code = script.compiled || script.source || "";
  if (!code.trim()) throw Object.assign(new Error(`Script "${script.filename}" has no compiled source`), { code: "SCRIPT_LOAD_ERROR" });

  const wrapped = `(function(module, exports, require) {\n${code}\n})`;
  const vmScript = new vm.Script(wrapped, { filename: script.filename });

  const mod = { exports: {} as Record<string, unknown> };
  const req = createRequire(import.meta.url);
  const ctx = vm.createContext({
    module: mod, exports: mod.exports, require: req,
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, JSON, Math, Date, Error, Array, Object, String, Number, Boolean, RegExp, Map, Set,
  });

  vmScript.runInContext(ctx, { timeout: SCRIPT_TIMEOUT_MS });

  const exports = (mod.exports ?? {}) as Record<string, unknown>;
  moduleCache.set(id, { exports, updatedAt: cacheKey });
  return exports;
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`Script timed out after ${SCRIPT_TIMEOUT_MS}ms in "${label}"`), { code: "SCRIPT_TIMEOUT" })),
      SCRIPT_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function compileTypeScript(source: string): Promise<{ js: string; error: string | null }> {
  try {
    const ts = await import("typescript");
    const result = ts.default.transpileModule(source, {
      compilerOptions: {
        module: ts.default.ModuleKind.CommonJS,
        target: ts.default.ScriptTarget.ES2020,
        strict: false,
        esModuleInterop: true,
      },
    });
    return { js: result.outputText, error: null };
  } catch (e: any) {
    return { js: "", error: e.message ?? "TypeScript compilation failed" };
  }
}

export async function runScript(
  script: IAppScript,
  ctx: EndpointContext,
  mode: ScriptMode,
  upstreamBody?: unknown
): Promise<HandlerResponse | null> {
  let exports: Record<string, unknown>;
  try {
    exports = loadModule(script);
  } catch (e: any) {
    throw Object.assign(new Error(`Script load error in "${script.filename}": ${e.message}`), { code: e.code ?? "SCRIPT_LOAD_ERROR" });
  }

  try {
    if (mode === "script_full") {
      const handler = exports["handler"] as ((ctx: EndpointContext) => Promise<HandlerResponse>) | undefined;
      if (typeof handler !== "function") throw Object.assign(new Error(`"${script.filename}" must export an async function named 'handler'`), { code: "SCRIPT_LOAD_ERROR" });
      return await withTimeout(handler(ctx), "handler");
    }

    if (mode === "script_pre") {
      const preHook = exports["preHook"] as ((ctx: EndpointContext) => Promise<HandlerResponse | void>) | undefined;
      if (typeof preHook !== "function") throw Object.assign(new Error(`"${script.filename}" must export an async function named 'preHook'`), { code: "SCRIPT_LOAD_ERROR" });
      return (await withTimeout(preHook(ctx), "preHook")) ?? null;
    }

    if (mode === "script_post") {
      const postHook = exports["postHook"] as ((ctx: EndpointContext, upstream: unknown) => Promise<HandlerResponse>) | undefined;
      if (typeof postHook !== "function") throw Object.assign(new Error(`"${script.filename}" must export an async function named 'postHook'`), { code: "SCRIPT_LOAD_ERROR" });
      return await withTimeout(postHook(ctx, upstreamBody), "postHook");
    }

    if (mode === "script_pre_post") {
      if (upstreamBody === undefined) {
        const preHook = exports["preHook"] as ((ctx: EndpointContext) => Promise<HandlerResponse | void>) | undefined;
        if (typeof preHook !== "function") throw Object.assign(new Error(`"${script.filename}" must export 'preHook'`), { code: "SCRIPT_LOAD_ERROR" });
        return (await withTimeout(preHook(ctx), "preHook")) ?? null;
      } else {
        const postHook = exports["postHook"] as ((ctx: EndpointContext, upstream: unknown) => Promise<HandlerResponse>) | undefined;
        if (typeof postHook !== "function") throw Object.assign(new Error(`"${script.filename}" must export 'postHook'`), { code: "SCRIPT_LOAD_ERROR" });
        return await withTimeout(postHook(ctx, upstreamBody), "postHook");
      }
    }
  } catch (e: any) {
    throw Object.assign(new Error(e.message ?? "Script execution failed"), { code: e.code ?? "SCRIPT_EXECUTION_ERROR" });
  }

  return null;
}
