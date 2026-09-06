import { Router } from "express";
import { App } from "../../models/App.js";
import { invalidateEndpointsForApp, upsertEndpointInCache } from "../../cache/endpointCache.js";
import { param } from "../../utils/params.js";
import { Endpoint } from "../../models/Endpoint.js";
import { AppScript } from "../../models/AppScript.js";
import { Secret } from "../../models/Secret.js";
import { VersionHistory } from "../../models/VersionHistory.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshApp } from "../../cache/appCache.js";
import { compileTypeScript } from "../../runtime/scriptRunner.js";

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

async function takeSnapshot(appId: string) {
  const app = await App.findById(appId).lean();
  const endpoints = await Endpoint.find({ app_id: appId }).lean();
  return { app: app ?? {}, endpoints };
}

async function writeHistory(appId: string, changeType: string, description: string, req: any) {
  const snapshot = await takeSnapshot(appId);
  await VersionHistory.create({
    app_id: appId,
    change_type: changeType,
    changed_by: { user_id: req.dashboardUser?.id ?? null, username: req.dashboardUser?.username ?? "system" },
    description,
    snapshot,
  });
}

// ── GET /apps ──────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query["status"])    filter["status"]    = req.query["status"];
  if (req.query["base_path"]) filter["base_path"] = req.query["base_path"];
  const apps = await App.find(filter).sort({ created_at: -1 }).lean();
  res.json({ count: apps.length, results: apps });
});

// ── POST /apps ─────────────────────────────────────────────────────────────────

router.post("/", requirePermission("manage:apps"), async (req, res) => {
  try {
    const app = await App.create({ ...req.body, created_by: req.dashboardUser?.id });
    await refreshApp(String(app._id));
    await writeHistory(String(app._id), "created", `App created: ${app.name}`, req);
    res.status(201).json(app);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "base_path already exists", code: "DUPLICATE_BASE_PATH" });
      return;
    }
    console.error("[apps POST]", err);
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── GET /apps/:id ──────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const app = await App.findById(param(req.params["id"])).lean();
  if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(app);
});

// ── PUT /apps/:id ──────────────────────────────────────────────────────────────
// base_path IS updatable. Uses $set to avoid MongoDB reserved-key issues.
// If the new base_path is already taken by a different app, returns 409.

router.put("/:id", requirePermission("manage:apps"), async (req, res) => {
  const appId = param(req.params["id"]);

  try {
    // Snapshot BEFORE the update so the history captures the old state
    const before = await App.findById(appId).lean();
    if (!before) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

    const app = await App.findByIdAndUpdate(
      appId,
      { $set: req.body },
      { new: true, runValidators: false }
    ).lean();

    if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

    // Immediately refresh the in-memory cache so status/base_path changes take
    // effect on the very next runtime request — no change streams required.
    await refreshApp(appId);

    // Build a meaningful description noting if base_path changed
    const oldPath  = (before as any).base_path as string;
    const newPath  = (app as any).base_path as string;
    const description = oldPath !== newPath
      ? `App base_path changed: ${oldPath} → ${newPath}`
      : `App settings updated: ${(app as any).name}`;

    await writeHistory(appId, "activated", description, req);
    res.json(app);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "base_path already exists", code: "DUPLICATE_BASE_PATH" });
      return;
    }
    console.error("[apps PUT]", err);
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── DELETE /apps/:id ───────────────────────────────────────────────────────────

router.delete("/:id", requirePermission("manage:apps"), async (req, res) => {
  const appId = param(req.params["id"]);
  await Endpoint.deleteMany({ app_id: appId });
  await VersionHistory.deleteMany({ app_id: appId });
  await App.findByIdAndDelete(appId);
  invalidateEndpointsForApp(appId);
  res.json({ success: true });
});

// ── POST /apps/:id/clone ───────────────────────────────────────────────────────

router.post("/:id/clone", requirePermission("manage:apps"), async (req, res) => {
  const source = await App.findById(param(req.params["id"])).lean();
  if (!source) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  try {
    const newApp = await App.create({
      name: req.body.name ?? `${source.name}-clone`,
      base_path: req.body.base_path,
      description: req.body.description ?? source.description,
      status: "draft",
      allowed_provider_ids: source.allowed_provider_ids,
      created_by: req.dashboardUser?.id,
    });

    const sourceEndpoints = await Endpoint.find({ app_id: source._id }).lean();
    for (const ep of sourceEndpoints) {
      const { _id, app_id, created_at, updated_at, ...rest } = ep as any;
      await Endpoint.create({ ...rest, app_id: newApp._id });
    }

    await refreshApp(String(newApp._id));
    await writeHistory(String(newApp._id), "cloned", `Cloned from ${source.name} (${(source as any).base_path})`, req);
    res.status(201).json(newApp);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "base_path already exists", code: "DUPLICATE_BASE_PATH" });
      return;
    }
    console.error("[apps clone]", err);
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── GET /apps/:id/export ───────────────────────────────────────────────────────
// Query params:
//   include = comma-separated list of "endpoints","scripts"  (default: both)
//   env     = "none" | "keys" | "values"                     (default: "keys")

router.get("/:id/export", requirePermission("export:app"), async (req, res) => {
  const appId = param(req.params["id"]);

  const app = await App.findById(appId).lean();
  if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  const includeRaw = String(req.query["include"] ?? "endpoints,scripts");
  const include = new Set(includeRaw.split(",").map(s => s.trim()).filter(Boolean));
  const envMode = (["none", "keys", "values"].includes(String(req.query["env"])) ? req.query["env"] : "keys") as "none" | "keys" | "values";

  // ── Resolve app_env ────────────────────────────────────────────────────────
  let exportedEnv: Array<{ key: string; value_type: string; plain_value?: string }> = [];
  if (envMode !== "none") {
    for (const e of (app as any).app_env ?? []) {
      if (e.value_type === "secret") {
        exportedEnv.push({ key: e.key, value_type: "secret" });
      } else {
        exportedEnv.push({
          key: e.key,
          value_type: "plain",
          ...(envMode === "values" ? { plain_value: e.plain_value ?? "" } : {}),
        });
      }
    }
  }

  // ── Endpoints ──────────────────────────────────────────────────────────────
  let exportedEndpoints: unknown[] = [];
  if (include.has("endpoints")) {
    const endpoints = await Endpoint.find({ app_id: appId }).lean();

    // Build script_id → filename map for this app's scripts (needed even if scripts not included)
    const scripts = await AppScript.find({ app_id: appId }).lean().select("_id filename");
    const scriptIdToFilename = new Map(scripts.map((s: any) => [String(s._id), s.filename]));

    for (const ep of endpoints) {
      const { _id, app_id, org_id, created_at, updated_at, __v, ...rest } = ep as any;

      // Resolve secret_ref ObjectId → secret name in upstream.auth_config
      let upstream = { ...(rest.upstream ?? {}) };
      if (upstream.auth_config?.secret_ref) {
        const secret = await Secret.findById(upstream.auth_config.secret_ref).select("name").lean();
        upstream = {
          ...upstream,
          auth_config: {
            ...upstream.auth_config,
            secret_ref: undefined,
            secret_ref_name: (secret as any)?.name ?? null,
          },
        };
      }

      exportedEndpoints.push({
        ...rest,
        upstream,
        script_file_id: undefined,
        script_filename: rest.script_file_id ? (scriptIdToFilename.get(String(rest.script_file_id)) ?? null) : null,
      });
    }
  }

  // ── Scripts ────────────────────────────────────────────────────────────────
  let exportedScripts: unknown[] = [];
  if (include.has("scripts")) {
    const scripts = await AppScript.find({ app_id: appId }).lean();
    exportedScripts = scripts.map((s: any) => ({
      filename:    s.filename,
      language:    s.language,
      source:      s.source,
      description: s.description,
      folder:      s.folder ?? null,
    }));
  }

  // ── App fields ─────────────────────────────────────────────────────────────
  const { _id, org_id, created_by, created_at, updated_at, __v, app_env, ...appRest } = app as any;
  const slug = (appRest.base_path as string).replace(/\//g, "-").replace(/^-/, "") || "app";

  const payload = {
    export_version:  "1",
    exported_at:     new Date().toISOString(),
    exported_from:   "orchestrator v1.0.0",
    export_options:  { include: [...include], env: envMode },
    app: {
      ...appRest,
      allowed_provider_ids: [],
      app_env: exportedEnv,
    },
    endpoints: exportedEndpoints,
    scripts:   exportedScripts,
  };

  const filename = `${slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(payload);
});

// ── POST /apps/import ──────────────────────────────────────────────────────────
// Body: { payload: AppExport, options?: { name?, base_path?, overwrite? } }

router.post("/import", requirePermission("manage:apps"), async (req, res) => {
  const { payload, options = {} } = req.body ?? {};

  if (!payload || payload.export_version !== "1") {
    res.status(400).json({ error: "Unsupported or missing export_version — only version 1 is supported", code: "UNSUPPORTED_EXPORT_VERSION" });
    return;
  }

  const warnings: string[] = [];
  const targetName     = options.name      ?? payload.app.name;
  const targetBasePath = options.base_path ?? payload.app.base_path;

  // ── Conflict check ─────────────────────────────────────────────────────────
  const existing = await App.findOne({ base_path: targetBasePath }).lean();
  if (existing) {
    if (!options.overwrite) {
      res.status(409).json({ error: "An app with this base_path already exists", code: "DUPLICATE_BASE_PATH", conflict: true, existing_app_id: String((existing as any)._id) });
      return;
    }
    // overwrite: true — delete existing app + its data
    const existingId = String((existing as any)._id);
    await Endpoint.deleteMany({ app_id: existingId });
    await AppScript.deleteMany({ app_id: existingId });
    await VersionHistory.deleteMany({ app_id: existingId });
    await App.findByIdAndDelete(existingId);
    invalidateEndpointsForApp(existingId);
  }

  // ── Create app ─────────────────────────────────────────────────────────────
  const { allowed_provider_ids: _providers, ...appFields } = payload.app;
  const newApp = await App.create({
    ...appFields,
    name:                targetName,
    base_path:           targetBasePath,
    status:              "draft",
    allowed_provider_ids: [],
    created_by:          req.dashboardUser?.id ?? null,
  });
  const newAppId = String(newApp._id);
  warnings.push("OIDC providers were not restored — provider IDs are instance-specific and cannot transfer between instances. Go to App Settings → Identity Providers and re-link the providers that should be allowed to authenticate against this app. Until then, all configured providers on this instance can access it.");

  // ── Create scripts + build filename → new _id map ─────────────────────────
  const filenameToId = new Map<string, string>();
  let scriptsCreated = 0;

  for (const s of payload.scripts ?? []) {
    let compiled = s.source ?? "";
    if (s.language === "typescript" && s.source?.trim()) {
      const { js, error } = await compileTypeScript(s.source);
      if (error) {
        warnings.push(`Script '${s.filename}' has a TypeScript compile error: ${error}. The script was saved with its original source but will not run until the compile error is fixed. Go to the Scripts tab and fix the error manually.`);
        compiled = "";
      } else {
        compiled = js;
      }
    }
    // Handle filename collision: append -2, -3, …
    let filename = s.filename;
    let suffix = 2;
    while (filenameToId.has(filename)) {
      const ext = s.filename.includes(".") ? s.filename.slice(s.filename.lastIndexOf(".")) : "";
      const base = s.filename.slice(0, s.filename.length - ext.length);
      filename = `${base}-${suffix}${ext}`;
      suffix++;
      if (suffix > 2) warnings.push(`Script '${s.filename}' already exists in this import — renamed to '${filename}' to avoid collision. Update any endpoints that reference this script in the Scripts tab.`);
    }
    const script = await AppScript.create({
      app_id:      newAppId,
      filename,
      language:    s.language,
      source:      s.source,
      compiled,
      description: s.description ?? "",
      folder:      s.folder ?? null,
    });
    filenameToId.set(filename, String(script._id));
    scriptsCreated++;
  }

  // ── Create endpoints ───────────────────────────────────────────────────────
  let endpointsCreated = 0;

  for (const ep of payload.endpoints ?? []) {
    const { script_file_id: _sfid, script_filename, upstream: epUpstream, ...epRest } = ep as any;

    // Resolve script_filename → new script_file_id
    const resolvedScriptId = script_filename ? (filenameToId.get(script_filename) ?? null) : null;
    if (script_filename && !resolvedScriptId) {
      warnings.push(`Endpoint '${epRest.name}' references script '${script_filename}' but that script was not included in this export file. The endpoint was created with no script assigned — go to the endpoint's Script tab and re-assign the correct script.`);
    }

    // Resolve secret_ref_name → secret ObjectId
    let upstream = { ...(epUpstream ?? {}) };
    if (upstream.auth_config?.secret_ref_name) {
      const secretName = upstream.auth_config.secret_ref_name;
      const secret = await Secret.findOne({ name: secretName }).select("_id").lean();
      if (!secret) {
        warnings.push(`Endpoint '${epRest.name}' uses secret '${secretName}' for upstream authentication, but no secret with that name exists on this instance. The endpoint was imported with auth disabled (secret_ref: null). Go to Admin → Secrets, create a secret named '${secretName}', then re-link it in the endpoint's Upstream tab under Auth Config.`);
        upstream = { ...upstream, auth_config: { ...upstream.auth_config, secret_ref_name: undefined, secret_ref: null } };
      } else {
        upstream = { ...upstream, auth_config: { ...upstream.auth_config, secret_ref_name: undefined, secret_ref: String((secret as any)._id) } };
      }
    }

    const created = await Endpoint.create({
      ...epRest,
      app_id:         newAppId,
      upstream,
      script_file_id: resolvedScriptId,
    });
    upsertEndpointInCache((created as any).toObject());
    endpointsCreated++;
  }

  // ── Finalise ───────────────────────────────────────────────────────────────
  await refreshApp(newAppId);
  await writeHistory(newAppId, "imported", `App imported: ${targetName} (from export file)`, req);

  res.status(201).json({
    app: newApp,
    endpoints_created: endpointsCreated,
    scripts_created:   scriptsCreated,
    warnings,
  });
});

// ── GET /apps/:id/history ──────────────────────────────────────────────────────

router.get("/:id/history", async (req, res) => {
  const history = await VersionHistory.find({ app_id: param(req.params["id"]) })
    .sort({ created_at: -1 })
    .lean();
  res.json({ count: history.length, results: history });
});

// ── POST /apps/:id/rollback ────────────────────────────────────────────────────

router.post("/:id/rollback", requirePermission("rollback"), async (req, res) => {
  const appId = param(req.params["id"]);
  const { snapshot_id } = req.body ?? {};

  const snapshot = await VersionHistory.findById(snapshot_id).lean();
  if (!snapshot || String(snapshot.app_id) !== appId) {
    res.status(404).json({ error: "Snapshot not found", code: "NOT_FOUND" });
    return;
  }

  await Endpoint.deleteMany({ app_id: appId });
  for (const ep of snapshot.snapshot.endpoints) {
    const { _id, ...rest } = ep as any;
    await Endpoint.create({ ...rest, app_id: appId });
  }
  await App.findByIdAndUpdate(appId, { $set: snapshot.snapshot.app });
  await refreshApp(appId);
  await writeHistory(appId, "rollback", `Rolled back to snapshot from ${new Date(snapshot.created_at).toLocaleString()}`, req);
  res.json({ success: true });
});

export default router;
