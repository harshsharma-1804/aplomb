import { Router, type Request } from "express";
import { Endpoint } from "../../models/Endpoint.js";
import { param } from "../../utils/params.js";
import { VersionHistory } from "../../models/VersionHistory.js";
import { App } from "../../models/App.js";
import { requirePermission } from "../../auth/rbac.js";
import { upstreamAllowlistGuard } from "../../middlewares/allowlistCheck.js";
import { callUpstream } from "../../runtime/upstream.js";
import { applyTransform } from "../../runtime/transform.js";
import { isHostAllowedForOrg } from "../../cache/allowlistCache.js";
import { resolveEnvVars } from "../../runtime/router.js";
import { runScript } from "../../runtime/scriptRunner.js";
import { buildContext } from "../../runtime/ctxBuilder.js";
import { AppScript } from "../../models/AppScript.js";

type EP = Request<{ appId: string; endId?: string }>;

const router = Router({ mergeParams: true });

// ── Helpers ────────────────────────────────────────────────────────────────────

async function writeHistory(appId: string, changeType: string, description: string, req: any) {
  const app = await App.findById(appId).lean();
  const endpoints = await Endpoint.find({ app_id: appId }).lean();
  await VersionHistory.create({
    app_id: appId,
    change_type: changeType,
    changed_by: { user_id: req.dashboardUser?.id ?? null, username: req.dashboardUser?.username ?? "system" },
    description,
    snapshot: { app: app ?? {}, endpoints },
  });
}

function handleDbError(err: any, res: any, context: string): void {
  if (err.code === 11000) {
    res.status(409).json({ error: "Endpoint with this method + path already exists", code: "DUPLICATE_ENDPOINT" });
    return;
  }
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e: any) => e.message).join("; ");
    res.status(400).json({ error: messages, code: "VALIDATION_ERROR" });
    return;
  }
  console.error(`[endpoints ${context}]`, err);
  res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
}

/**
 * subResourceUpdate — updates a single nested field using $set with dot-notation.
 * Using $set prevents MongoDB rejecting field names that are JS reserved words
 * (e.g. form_encoding has a field called "null").
 */
function subResourceUpdate(field: string) {
  return async (req: any, res: any): Promise<void> => {
    try {
      const ep = await Endpoint.findOneAndUpdate(
        { _id: param(req.params["endId"]), app_id: param(req.params["appId"]) },
        { $set: { [field]: req.body } },
        { new: true, runValidators: false }
      ).lean();
      if (!ep) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
      await writeHistory(param(req.params["appId"]), "endpoint_modified", `Endpoint ${field} updated`, req);
      res.json(ep);
    } catch (err: any) {
      handleDbError(err, res, `PUT ${field}`);
    }
  };
}

/**
 * Extract path parameter names from an endpoint path pattern.
 * e.g. "/claims/{claimId}/lines/{lineId}" → ["claimId", "lineId"]
 */
function extractPathParams(path: string): string[] {
  const matches = path.match(/\{([^}]+)\}/g) ?? [];
  return matches.map(m => m.slice(1, -1));
}

/**
 * Merge auto-extracted path params with any existing ones configured by the admin.
 * Existing entries are preserved (they may have type/required set by admin).
 * New params found in the path are added with defaults.
 */
function syncPathParams(
  path: string,
  existing: Array<{ name: string; type: string; required: boolean }>
): Array<{ name: string; type: string; required: boolean }> {
  const names = extractPathParams(path);
  if (names.length === 0) return existing;

  const result = [...existing];
  for (const name of names) {
    if (!result.find(p => p.name === name)) {
      result.push({ name, type: "string", required: true });
    }
  }
  return result;
}

// ── GET /apps/:appId/endpoints ─────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const ps = req.params as Record<string, string>;
  const endpoints = await Endpoint.find({ app_id: param(ps["appId"]) }).lean();
  res.json({ count: endpoints.length, results: endpoints });
});

// ── POST /apps/:appId/endpoints ────────────────────────────────────────────────

router.post(
  "/",
  requirePermission("edit:endpoints"),
  upstreamAllowlistGuard,
  async (req, res) => {
    try {
      const body = { ...req.body };
      // Auto-sync path_params from the path pattern so the Test tab always has inputs
      if (body.path) {
        body.path_params = syncPathParams(body.path, body.path_params ?? []);
      }
      const ep = await Endpoint.create({ ...body, app_id: param(req.params["appId"]) });
      await writeHistory(param(req.params["appId"]), "endpoint_added", `Endpoint added: ${ep.method} ${ep.path}`, req);
      res.status(201).json(ep);
    } catch (err: any) {
      handleDbError(err, res, "POST");
    }
  }
);

// ── GET /apps/:appId/endpoints/:endId ─────────────────────────────────────────

router.get("/:endId", async (req, res) => {
  const ps = req.params as Record<string, string>;
  const ep = await Endpoint.findOne({ _id: param(ps["endId"]), app_id: param(ps["appId"]) }).lean();
  if (!ep) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(ep);
});

// ── PUT /apps/:appId/endpoints/:endId — full update ───────────────────────────

router.put(
  "/:endId",
  requirePermission("edit:endpoints"),
  upstreamAllowlistGuard,
  async (req, res) => {
    try {
      const body = { ...req.body };
      // Auto-sync path_params whenever the path changes
      if (body.path) {
        body.path_params = syncPathParams(body.path, body.path_params ?? []);
      }
      const ep = await Endpoint.findOneAndUpdate(
        { _id: param(req.params["endId"]), app_id: param(req.params["appId"]) },
        { $set: body },
        { new: true, runValidators: false }
      ).lean();
      if (!ep) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
      await writeHistory(param(req.params["appId"]), "endpoint_modified", `Endpoint modified: ${(ep as any).method} ${(ep as any).path}`, req);
      res.json(ep);
    } catch (err: any) {
      handleDbError(err, res, "PUT");
    }
  }
);

// ── DELETE /apps/:appId/endpoints/:endId ──────────────────────────────────────

router.delete("/:endId", requirePermission("edit:endpoints"), async (req, res) => {
  try {
    const ep = await Endpoint.findOneAndDelete({
      _id: param(req.params["endId"]),
      app_id: param(req.params["appId"]),
    }).lean();
    if (!ep) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    await writeHistory(param(req.params["appId"]), "endpoint_deleted", `Endpoint deleted: ${(ep as any).method} ${(ep as any).path}`, req);
    res.json({ success: true });
  } catch (err: any) {
    handleDbError(err, res, "DELETE");
  }
});

// ── Sub-resource PUT routes ────────────────────────────────────────────────────

router.put("/:endId/input-schema",  requirePermission("edit:endpoints"), subResourceUpdate("request.input_schema"));
router.put("/:endId/output-schema", requirePermission("edit:endpoints"), subResourceUpdate("output_schema"));
router.put("/:endId/query-params",  requirePermission("edit:endpoints"), subResourceUpdate("query_params"));
router.put("/:endId/path-params",   requirePermission("edit:endpoints"), subResourceUpdate("path_params"));
router.put("/:endId/sample",        requirePermission("edit:endpoints"), subResourceUpdate("sample_response"));
router.put("/:endId/mappings",      requirePermission("edit:endpoints"), subResourceUpdate("field_mappings"));
router.put("/:endId/body-mappings", requirePermission("edit:endpoints"), subResourceUpdate("upstream.body_mappings"));
router.put(
  "/:endId/upstream",
  requirePermission("edit:endpoints"),
  upstreamAllowlistGuard,
  subResourceUpdate("upstream")
);

// ── PUT /:endId/script-config — set script_mode + script_file_id ──────────────

router.put("/:endId/script-config", requirePermission("edit:endpoints"), async (req, res) => {
  try {
    const { script_mode, script_file_id } = req.body as { script_mode: string; script_file_id: string | null };
    const ep = await Endpoint.findOneAndUpdate(
      { _id: param(req.params["endId"]), app_id: param(req.params["appId"]) },
      { $set: { script_mode: script_mode ?? "none", script_file_id: script_file_id ?? null } },
      { new: true, runValidators: false }
    ).lean();
    if (!ep) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    await writeHistory(param(req.params["appId"]), "endpoint_modified", `Script config updated for endpoint ${(ep as any).method} ${(ep as any).path}`, req);
    res.json(ep);
  } catch (err: any) {
    handleDbError(err, res, "PUT script-config");
  }
});

// ── POST /:endId/test — execute a live test run ────────────────────────────────

router.post("/:endId/test", requirePermission("view:any"), async (req, res) => {
  const ps = req.params as Record<string, string>;
  const ep = await Endpoint.findOne({ _id: param(ps["endId"]), app_id: param(ps["appId"]) }).lean();
  if (!ep) { res.status(404).json({ error: "Endpoint not found", code: "NOT_FOUND" }); return; }

  const {
    path_params   = {} as Record<string, string>,
    query_params  = {} as Record<string, string>,
    request_body  = null as unknown,
    test_headers  = {} as Record<string, string>,
  } = req.body ?? {};

  try {
    // Build query string from endpoint config merged with test overrides
    const upstreamQuery = new URLSearchParams();
    for (const qp of ep.query_params ?? []) {
      const val = (query_params as Record<string, string>)[qp.frontend_param] ?? qp.default_value;
      if (val !== undefined) upstreamQuery.set(qp.upstream_param, val);
    }

    // Resolve {{ENV_VAR}} references using the parent app's environment
    const appDoc = await App.findById(param(ps["appId"])).lean();
    let urlTemplate = ep.upstream.url;
    if (appDoc) urlTemplate = await resolveEnvVars(urlTemplate, appDoc as any);

    // Case-insensitive path param substitution — non-destructive (leaves {param} if not found)
    const pp = path_params as Record<string, string>;
    const ppLower: Record<string, string> = {};
    for (const [k, v] of Object.entries(pp)) ppLower[k.toLowerCase()] = v;

    let resolvedUrl = urlTemplate.replace(/\{([^}]+)\}/g, (match, name) => {
      const val = pp[name] ?? ppLower[name.toLowerCase()];
      return val !== undefined ? encodeURIComponent(val) : match;
    });

    if (upstreamQuery.toString()) resolvedUrl += "?" + upstreamQuery.toString();

    // Use org-scoped DB allowlist (same as runtime). Also skip if URL still
    // contains {{VAR}} — means env var was not resolved (key not in app_env).
    const orgId = appDoc ? String((appDoc as any).org_id ?? "") : "";
    if (!isHostAllowedForOrg(resolvedUrl, orgId)) {
      res.status(400).json({
        error: "Upstream host is not in your organization's allowlist. Add it under Tenant Settings → Host Allowlist.",
        code: "HOST_NOT_ALLOWED",
      });
      return;
    }

    // Build headers: static → forwarded rules (simulated via test_headers) → test overrides → auth
    const upstreamHeaders: Record<string, string> = {};

    // Step 1: Static headers from config; resolve {{ENV_VAR}} in values
    for (const sh of (ep.upstream as any).static_headers ?? []) {
      if (sh.name) {
        const val = appDoc ? await resolveEnvVars(sh.value ?? "", appDoc as any) : (sh.value ?? "");
        upstreamHeaders[sh.name] = val;
      }
    }

    // Step 2: Forwarding rules — resolve from test_headers (simulate what the real frontend sends)
    const testHeadersObj = test_headers as Record<string, string>;
    for (const fh of (ep.upstream as any).forwarded_headers ?? []) {
      const fromNameClean = (fh.from_name ?? "").trim().toLowerCase();
      const incomingValue = testHeadersObj[fh.from_name?.trim()] ?? testHeadersObj[fromNameClean];
      if (!incomingValue) {
        if (fh.required) {
          res.status(400).json({
            error: `Required header "${fh.from_name}" is missing. Add it in the Test Headers section to simulate the real frontend.`,
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

    // Step 3: Additional test-time header overrides (merged last so they win over static)
    for (const [k, v] of Object.entries(testHeadersObj)) {
      if (k) upstreamHeaders[k] = v;
    }

    // Body
    let upstreamBody: string | null = null;
    if (request_body !== null && request_body !== undefined) {
      upstreamBody = typeof request_body === "string" ? request_body : JSON.stringify(request_body);
      upstreamHeaders["Content-Type"] = ep.upstream.body_content_type;
    }

    // Record what we're about to send (for the "Upstream Request" panel in the UI)
    const upstreamRequestPreview = {
      url: resolvedUrl,
      method: ep.upstream.method,
      headers: { ...upstreamHeaders },
      body: upstreamBody,
    };

    const scriptMode = (ep as any).script_mode ?? "none";
    const scriptLogs: Array<{ level: string; message: string; data?: Record<string, unknown>; ts: string }> = [];

    if (scriptMode === "script_full") {
      const orgId = appDoc ? String((appDoc as any).org_id ?? "") : "";
      const ctx = buildContext(appDoc as any, orgId, request_body ?? {}, pp, query_params as Record<string, string>, null, scriptLogs);
      const scriptFileId = (ep as any).script_file_id;
      const scriptDoc = scriptFileId ? await AppScript.findById(scriptFileId).lean() : null;
      if (!scriptDoc) {
        res.status(400).json({ error: "No script file assigned to this endpoint", code: "SCRIPT_LOAD_ERROR" }); return;
      }
      try {
        const scriptResult = await runScript(scriptDoc as any, ctx, "script_full");
        if (!scriptResult || scriptResult.body === undefined) {
          res.status(502).json({ error: "Script did not return a valid response", code: "SCRIPT_INVALID_RESPONSE" }); return;
        }
        let transformed: Record<string, unknown> = {};
        let transformError: string | null = null;
        try { transformed = applyTransform(scriptResult.body, (ep as any).output_schema ?? [], (ep as any).field_mappings ?? []); }
        catch (e: any) { transformError = e.message; }
        res.json({ upstreamRequest: { mode: "script_full", language: (ep as any).script_language }, upstream: scriptResult.body, transformed, validation: [], transformError, upstreamStatus: scriptResult.status ?? 200, scriptLogs });
      } catch (e: any) {
        res.status(502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR", scriptLogs });
      }
      return;
    }

    const result = await callUpstream(ep as any, resolvedUrl, ep.upstream.method, upstreamHeaders, upstreamBody, null);

    let upstreamJson: unknown;
    try { upstreamJson = JSON.parse(result.body); } catch { upstreamJson = result.body; }

    if (scriptMode === "script_post" || scriptMode === "script_pre_post") {
      const orgId = appDoc ? String((appDoc as any).org_id ?? "") : "";
      const ctx = buildContext(appDoc as any, orgId, request_body ?? {}, pp, query_params as Record<string, string>, null, scriptLogs);
      const scriptFileId = (ep as any).script_file_id;
      const scriptDoc = scriptFileId ? await AppScript.findById(scriptFileId).lean() : null;
      if (!scriptDoc) {
        res.status(400).json({ error: "No script file assigned to this endpoint", code: "SCRIPT_LOAD_ERROR" }); return;
      }
      try {
        const postResult = await runScript(scriptDoc as any, ctx, scriptMode === "script_post" ? "script_post" : "script_pre_post", upstreamJson);
        if (postResult) upstreamJson = postResult.body;
      } catch (e: any) {
        res.status(502).json({ error: e.message, code: e.code ?? "SCRIPT_EXECUTION_ERROR", scriptLogs }); return;
      }
    }

    let transformed: Record<string, unknown> = {};
    let transformError: string | null = null;
    try {
      transformed = applyTransform(upstreamJson, (ep as any).output_schema ?? [], (ep as any).field_mappings ?? []);
    } catch (err: any) {
      transformError = err.message;
    }

    // Basic schema validation for the result panel
    const validation: Array<{ field_path: string; status: string; value: unknown }> = [];
    function walkSchema(fields: any[], obj: any, prefix = "") {
      for (const f of fields ?? []) {
        const fullPath = prefix ? `${prefix}.${f.field_path}` : f.field_path;
        const value = obj?.[f.field_path];
        const missing = value === undefined || value === null;
        validation.push({
          field_path: fullPath,
          status: missing && !f.nullable ? "missing" : missing ? "nullable_absent" : "matched",
          value: missing ? undefined : value,
        });
        if (f.type === "object" && f.item_schema) walkSchema(f.item_schema, value, fullPath);
      }
    }
    walkSchema((ep as any).output_schema ?? [], transformed);

    res.json({
      upstreamRequest: upstreamRequestPreview,
      upstream: upstreamJson,
      transformed,
      validation,
      transformError,
      upstreamStatus: result.status,
      scriptLogs,
    });
  } catch (err: any) {
    console.error("[test endpoint]", err);
    res.status(502).json({ error: err.message ?? "Test call failed", code: "TEST_UPSTREAM_ERROR" });
  }
});

export default router;
