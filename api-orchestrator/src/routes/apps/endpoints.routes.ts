import { Router } from "express";
import { getDb } from "../../db/client.js";
import { appRepo } from "../../db/repos/appRepo.js";
import { endpointRepo } from "../../db/repos/endpointRepo.js";
import { scriptRepo } from "../../db/repos/scriptRepo.js";
import { versionHistoryRepo } from "../../db/repos/versionHistoryRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { upstreamAllowlistGuard } from "../../middlewares/allowlistCheck.js";
import { callUpstream } from "../../runtime/upstream.js";
import { applyTransform } from "../../runtime/transform.js";
import { isHostAllowedForOrg } from "../../cache/allowlistCache.js";
import { resolveEnvVars } from "../../runtime/router.js";
import { runScript } from "../../runtime/scriptRunner.js";
import { buildContext } from "../../runtime/ctxBuilder.js";

const router = Router({ mergeParams: true });

function changedBy(req: any) {
  return { user_id: req.dashboardUser?.id ?? null, username: req.dashboardUser?.username ?? "system" };
}

function writeHistory(appId: string, changeType: string, description: string, req: any) {
  const db = getDb();
  const app = appRepo.findById(db, appId) ?? {};
  const eps = endpointRepo.findByAppId(db, appId);
  versionHistoryRepo.create(db, { app_id: appId, change_type: changeType, changed_by: changedBy(req), description, snapshot: { app, endpoints: eps } });
}

function extractPathParams(path: string): string[] {
  return (path.match(/\{([^}]+)\}/g) ?? []).map(m => m.slice(1, -1));
}

function syncPathParams(path: string, existing: Array<{ name: string; type: string; required: boolean }>) {
  const names = extractPathParams(path);
  if (names.length === 0) return existing;
  const result = [...existing];
  for (const name of names) {
    if (!result.find(p => p.name === name)) result.push({ name, type: "string", required: true });
  }
  return result;
}

// ── GET /apps/:appId/endpoints ────────────────────────────────────────────────

router.get("/", (req, res) => {
  const ps = req.params as Record<string, string>;
  const eps = endpointRepo.findByAppId(getDb(), ps["appId"]!);
  res.json({ count: eps.length, results: eps });
});

// ── POST /apps/:appId/endpoints ───────────────────────────────────────────────

router.post("/", requirePermission("edit:endpoints"), upstreamAllowlistGuard, (req, res) => {
  const ps = req.params as Record<string, string>;
  const body = { ...req.body };
  if (body.path) body.path_params = syncPathParams(body.path, body.path_params ?? []);
  try {
    const ep = endpointRepo.create(getDb(), { ...body, app_id: ps["appId"]! });
    writeHistory(ps["appId"]!, "endpoint_added", `Endpoint added: ${ep.method} ${ep.path}`, req);
    res.status(201).json(ep);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Endpoint with this method + path already exists", code: "DUPLICATE_ENDPOINT" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── GET /apps/:appId/endpoints/:endId ────────────────────────────────────────

router.get("/:endId", (req, res) => {
  const ps = req.params as Record<string, string>;
  const ep = endpointRepo.findById(getDb(), ps["endId"]!);
  if (!ep || ep.app_id !== ps["appId"]!) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(ep);
});

// ── PUT /apps/:appId/endpoints/:endId ────────────────────────────────────────

router.put("/:endId", requirePermission("edit:endpoints"), upstreamAllowlistGuard, (req, res) => {
  const ps = req.params as Record<string, string>;
  const db = getDb();
  const existing = endpointRepo.findById(db, ps["endId"]!);
  if (!existing || existing.app_id !== ps["appId"]!) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const body = { ...req.body };
  if (body.path) body.path_params = syncPathParams(body.path, body.path_params ?? []);
  try {
    const ep = endpointRepo.update(db, ps["endId"]!, body);
    writeHistory(ps["appId"]!, "endpoint_modified", `Endpoint modified: ${ep?.method} ${ep?.path}`, req);
    res.json(ep);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Endpoint with this method + path already exists", code: "DUPLICATE_ENDPOINT" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── DELETE /apps/:appId/endpoints/:endId ──────────────────────────────────────

router.delete("/:endId", requirePermission("edit:endpoints"), (req, res) => {
  const ps = req.params as Record<string, string>;
  const db = getDb();
  const ep = endpointRepo.findById(db, ps["endId"]!);
  if (!ep || ep.app_id !== ps["appId"]!) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  endpointRepo.delete(db, ps["endId"]!);
  writeHistory(ps["appId"]!, "endpoint_deleted", `Endpoint deleted: ${ep.method} ${ep.path}`, req);
  res.json({ success: true });
});

// ── Sub-resource PUT helpers ──────────────────────────────────────────────────

function subUpdate(field: string, guard?: typeof upstreamAllowlistGuard) {
  const handlers: any[] = [requirePermission("edit:endpoints")];
  if (guard) handlers.push(guard);
  handlers.push((req: any, res: any) => {
    const ps = req.params as Record<string, string>;
    const db = getDb();
    const ep = endpointRepo.findById(db, ps["endId"]!);
    if (!ep || ep.app_id !== ps["appId"]!) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    endpointRepo.updateField(db, ps["endId"]!, field, req.body);
    const updated = endpointRepo.findById(db, ps["endId"]!);
    writeHistory(ps["appId"]!, "endpoint_modified", `Endpoint ${field} updated`, req);
    res.json(updated);
  });
  return handlers;
}

router.put("/:endId/input-schema",  ...subUpdate("request"));
router.put("/:endId/output-schema", ...subUpdate("output_schema"));
router.put("/:endId/query-params",  ...subUpdate("query_params"));
router.put("/:endId/path-params",   ...subUpdate("path_params"));
router.put("/:endId/sample",        ...subUpdate("sample_response"));
router.put("/:endId/mappings",      ...subUpdate("field_mappings"));
router.put("/:endId/body-mappings", ...subUpdate("upstream"));
router.put("/:endId/upstream",      ...subUpdate("upstream", upstreamAllowlistGuard));

// ── PUT /:endId/script-config ─────────────────────────────────────────────────

router.put("/:endId/script-config", requirePermission("edit:endpoints"), (req, res) => {
  const ps = req.params as Record<string, string>;
  const db = getDb();
  const ep = endpointRepo.findById(db, ps["endId"]!);
  if (!ep || ep.app_id !== ps["appId"]!) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const { script_mode, script_file_id } = req.body;
  endpointRepo.update(db, ps["endId"]!, { script_mode: script_mode ?? "none", script_file_id: script_file_id ?? null });
  const updated = endpointRepo.findById(db, ps["endId"]!);
  writeHistory(ps["appId"]!, "endpoint_modified", `Script config updated for endpoint ${ep.method} ${ep.path}`, req);
  res.json(updated);
});

// ── POST /:endId/test ─────────────────────────────────────────────────────────

router.post("/:endId/test", requirePermission("view:any"), async (req, res) => {
  const ps = req.params as Record<string, string>;
  const db = getDb();
  const ep = endpointRepo.findById(db, ps["endId"]!);
  if (!ep || ep.app_id !== ps["appId"]!) { res.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND" }); return; }

  const { path_params = {}, query_params = {}, request_body = null, test_headers = {} } = req.body ?? {};

  try {
    const appDoc = appRepo.findById(db, ps["appId"]!);
    const scriptMode = ep.script_mode ?? "none";
    const scriptLogs: any[] = [];
    const pp = path_params as Record<string, string>;
    const orgId = "";

    if (scriptMode === "script_full") {
      const scriptFileId = ep.script_file_id;
      const scriptDoc = scriptFileId ? scriptRepo.findById(db, scriptFileId) : null;
      if (!scriptDoc) { res.status(400).json({ error: "No script file assigned", code: "SCRIPT_LOAD_ERROR" }); return; }
      const ctx = buildContext(appDoc as any, orgId, request_body ?? {}, pp, query_params as any, null, scriptLogs);
      try {
        const scriptResult = await runScript(scriptDoc as any, ctx, "script_full");
        if (!scriptResult || scriptResult.body === undefined) { res.status(502).json({ error: "Script did not return a valid response", code: "SCRIPT_INVALID_RESPONSE" }); return; }
        let transformed: any = {};
        let transformError: string | null = null;
        try { transformed = applyTransform(scriptResult.body, ep.output_schema ?? [], ep.field_mappings ?? []); } catch (e: any) { transformError = e.message; }
        res.json({ upstreamRequest: { mode: "script_full", script: scriptDoc.filename }, upstream: scriptResult.body, transformed, validation: [], transformError, upstreamStatus: scriptResult.status ?? 200, scriptLogs });
      } catch (e: any) {
        res.status(502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR", scriptLogs });
      }
      return;
    }

    let urlTemplate = (ep.upstream as any).url ?? "";
    if (appDoc) urlTemplate = await resolveEnvVars(urlTemplate, appDoc as any);

    const ppLower: Record<string, string> = {};
    for (const [k, v] of Object.entries(pp)) ppLower[k.toLowerCase()] = v;
    let resolvedUrl = urlTemplate.replace(/\{([^}]+)\}/g, (match: string, name: string) => {
      const val = pp[name] ?? ppLower[name.toLowerCase()];
      return val !== undefined ? encodeURIComponent(val) : match;
    });

    const upstreamQuery = new URLSearchParams();
    for (const qp of (ep.query_params ?? []) as any[]) {
      const val = (query_params as any)[qp.frontend_param] ?? qp.default_value;
      if (val !== undefined) upstreamQuery.set(qp.upstream_param, val);
    }
    if (upstreamQuery.toString()) resolvedUrl += "?" + upstreamQuery.toString();

    if (!isHostAllowedForOrg(resolvedUrl, orgId)) {
      res.status(400).json({ error: "Upstream host is not in your organization's allowlist.", code: "HOST_NOT_ALLOWED" }); return;
    }

    const upstreamHeaders: Record<string, string> = {};
    for (const sh of (ep.upstream as any).static_headers ?? []) {
      if (sh.name) upstreamHeaders[sh.name] = appDoc ? await resolveEnvVars(sh.value ?? "", appDoc as any) : (sh.value ?? "");
    }
    const testHeadersObj = test_headers as Record<string, string>;
    for (const fh of (ep.upstream as any).forwarded_headers ?? []) {
      const incoming = testHeadersObj[(fh.from_name ?? "").trim()] ?? testHeadersObj[(fh.from_name ?? "").trim().toLowerCase()];
      if (!incoming) {
        if (fh.required) { res.status(400).json({ error: `Required header "${fh.from_name}" is missing.`, code: "REQUIRED_HEADER_MISSING", header: fh.from_name }); return; }
        continue;
      }
      upstreamHeaders[fh.to_name?.trim() || fh.from_name] = incoming;
    }
    for (const [k, v] of Object.entries(testHeadersObj)) { if (k) upstreamHeaders[k] = v; }

    let upstreamBody: string | null = null;
    if (request_body !== null && request_body !== undefined) {
      upstreamBody = typeof request_body === "string" ? request_body : JSON.stringify(request_body);
      upstreamHeaders["Content-Type"] = (ep.upstream as any).body_content_type ?? "application/json";
    }

    const upstreamRequestPreview = { url: resolvedUrl, method: (ep.upstream as any).method, headers: { ...upstreamHeaders }, body: upstreamBody };
    const result = await callUpstream(ep as any, resolvedUrl, (ep.upstream as any).method, upstreamHeaders, upstreamBody, null);

    let upstreamJson: unknown;
    try { upstreamJson = JSON.parse(result.body); } catch { upstreamJson = result.body; }

    if (scriptMode === "script_post" || scriptMode === "script_pre_post") {
      const scriptFileId = ep.script_file_id;
      const scriptDoc = scriptFileId ? scriptRepo.findById(db, scriptFileId) : null;
      if (!scriptDoc) { res.status(400).json({ error: "No script file assigned", code: "SCRIPT_LOAD_ERROR" }); return; }
      const ctx = buildContext(appDoc as any, orgId, request_body ?? {}, pp, query_params as any, null, scriptLogs);
      try {
        const postResult = await runScript(scriptDoc as any, ctx, scriptMode === "script_post" ? "script_post" : "script_pre_post", upstreamJson);
        if (postResult) upstreamJson = postResult.body;
      } catch (e: any) { res.status(502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR", scriptLogs }); return; }
    }

    let transformed: any = {};
    let transformError: string | null = null;
    try { transformed = applyTransform(upstreamJson, ep.output_schema ?? [], ep.field_mappings ?? []); } catch (e: any) { transformError = e.message; }

    const validation: any[] = [];
    function walkSchema(fields: any[], obj: any, prefix = "") {
      for (const f of fields ?? []) {
        const fullPath = prefix ? `${prefix}.${f.field_path}` : f.field_path;
        const value = obj?.[f.field_path];
        const missing = value === undefined || value === null;
        validation.push({ field_path: fullPath, status: missing && !f.nullable ? "missing" : missing ? "nullable_absent" : "matched", value: missing ? undefined : value });
        if (f.type === "object" && f.item_schema) walkSchema(f.item_schema, value, fullPath);
      }
    }
    walkSchema(ep.output_schema ?? [], transformed);

    res.json({ upstreamRequest: upstreamRequestPreview, upstream: upstreamJson, transformed, validation, transformError, upstreamStatus: result.status, scriptLogs });
  } catch (err: any) {
    console.error("[test endpoint]", err);
    res.status(502).json({ error: err.message ?? "Test call failed", code: "TEST_UPSTREAM_ERROR" });
  }
});

export default router;
