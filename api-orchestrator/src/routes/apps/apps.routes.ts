import { param } from "../../utils/params.js";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { appRepo } from "../../db/repos/appRepo.js";
import { endpointRepo } from "../../db/repos/endpointRepo.js";
import { scriptRepo } from "../../db/repos/scriptRepo.js";
import { secretRepo } from "../../db/repos/secretRepo.js";
import { versionHistoryRepo } from "../../db/repos/versionHistoryRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshApp } from "../../cache/appCache.js";
import { compileTypeScript } from "../../runtime/scriptRunner.js";
import { refreshToolRegistry } from "../../ai/toolRegistry.js";
import { appUserRepo } from "../../db/repos/appUserRepo.js";
import { appSessionRepo, resolveSessionConfig } from "../../db/repos/appSessionRepo.js";
import { aiBotRepo } from "../../db/repos/aiBotRepo.js";
import { buildBotBundle, importProviders, importBotBundle } from "../../ai/botTransfer.js";
import { validateCookieName, sessionCookieName } from "../../auth/appSessionAuth.js";
import { config } from "../../config/appConfig.js";

const router = Router();

function changedBy(req: any) {
  return { user_id: req.dashboardUser?.id ?? null, username: req.dashboardUser?.username ?? "system" };
}

function writeHistory(appId: string, changeType: string, description: string, req: any) {
  const db = getDb();
  const app = appRepo.findById(db, appId) ?? {};
  const endpoints = endpointRepo.findByAppId(db, appId);
  versionHistoryRepo.create(db, { app_id: appId, change_type: changeType, changed_by: changedBy(req), description, snapshot: { app, endpoints } });
}

router.get("/", (req, res) => {
  let apps = appRepo.list(getDb());
  if (req.query["status"])    apps = apps.filter(a => a.status    === req.query["status"]);
  if (req.query["base_path"]) apps = apps.filter(a => a.base_path === req.query["base_path"]);
  res.json({ count: apps.length, results: apps });
});

router.post("/", requirePermission("manage:apps"), (req, res) => {
  try {
    const app = appRepo.create(getDb(), { ...req.body, created_by: req.dashboardUser?.id });
    refreshApp(app.id);
    refreshToolRegistry();
    writeHistory(app.id, "created", `App created: ${app.name}`, req);
    res.status(201).json(app);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "base_path already exists", code: "DUPLICATE_BASE_PATH" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.get("/:id", (req, res) => {
  const app = appRepo.findById(getDb(), param(param(req.params["id"])));
  if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(app);
});

router.put("/:id", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const before = appRepo.findById(db, param(param(req.params["id"])));
  if (!before) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  try {
    const app = appRepo.update(db, param(param(req.params["id"])), req.body);
    if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    refreshApp(app.id);
    refreshToolRegistry();
    const desc = before.base_path !== app.base_path
      ? `App base_path changed: ${before.base_path} → ${app.base_path}`
      : `App settings updated: ${app.name}`;
    writeHistory(app.id, "activated", desc, req);
    res.json(app);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "base_path already exists", code: "DUPLICATE_BASE_PATH" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/:id", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const id = param(param(req.params["id"]));
  endpointRepo.deleteByAppId(db, id);
  scriptRepo.deleteByAppId(db, id);
  versionHistoryRepo.deleteByAppId(db, id);
  appRepo.delete(db, id);
  refreshToolRegistry();
  res.json({ success: true });
});

router.post("/:id/clone", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const source = appRepo.findById(db, param(param(req.params["id"])));
  if (!source) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  try {
    const newApp = appRepo.create(db, {
      name: req.body.name ?? `${source.name}-clone`,
      base_path: req.body.base_path,
      description: req.body.description ?? source.description,
      status: "draft",
      allowed_provider_ids: source.allowed_provider_ids,
      created_by: req.dashboardUser?.id,
    });
    for (const ep of endpointRepo.findByAppId(db, source.id)) {
      const { id: _id, app_id: _app_id, created_at: _c, updated_at: _u, ...rest } = ep as any;
      endpointRepo.create(db, { ...rest, app_id: newApp.id });
    }
    refreshApp(newApp.id);
    writeHistory(newApp.id, "cloned", `Cloned from ${source.name} (${source.base_path})`, req);
    res.status(201).json(newApp);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "base_path already exists", code: "DUPLICATE_BASE_PATH" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── PUT /apps/:id/session-auth — Runtime Authentication settings ───────────────

router.put("/:id/session-auth", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  const app = appRepo.findById(db, appId);
  if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  const { auth_mode, session_method, session_config } = req.body ?? {};
  if (auth_mode !== undefined && !["bearer", "session", "both"].includes(auth_mode)) {
    res.status(400).json({ error: "auth_mode must be bearer | session | both", code: "VALIDATION_ERROR" }); return;
  }
  if (session_method !== undefined && !["gateway", "identity", "both"].includes(session_method)) {
    res.status(400).json({ error: "session_method must be gateway | identity | both", code: "VALIDATION_ERROR" }); return;
  }

  const current = resolveSessionConfig(app);
  const merged = { ...current, ...(session_config ?? {}) };

  if (merged.ua_enforce !== undefined && !["off", "flag", "enforce"].includes(merged.ua_enforce)) {
    res.status(400).json({ error: "ua_enforce must be off | flag | enforce", code: "VALIDATION_ERROR" }); return;
  }
  merged.ttl_idle_min = Math.max(5, Math.min(Number(merged.ttl_idle_min) || 30, 1440));
  merged.max_age_min = Math.max(15, Math.min(Number(merged.max_age_min) || 480, 10080));
  merged.max_sessions_per_user = Math.max(1, Math.min(Number(merged.max_sessions_per_user) || 5, 20));

  if (merged.cookie_name !== undefined && merged.cookie_name !== "") {
    const err = validateCookieName(db, appId, merged.cookie_name);
    if (err) { res.status(400).json({ error: err, code: "INVALID_COOKIE_NAME" }); return; }
  }

  const updated = appRepo.update(db, appId, {
    ...(auth_mode !== undefined ? { auth_mode } : {}),
    ...(session_method !== undefined ? { session_method } : {}),
    session_config: merged,
  } as any);
  refreshApp(appId);
  writeHistory(appId, "modified", `Runtime authentication updated (mode: ${updated?.auth_mode})`, req);
  res.json({
    auth_mode: updated?.auth_mode,
    session_method: updated?.session_method,
    session_config: updated?.session_config,
    effective_cookie_name: sessionCookieName(updated as any),
    dashboard_cookie_name: config.cookies.name,
  });
});

// ── GET /apps/:id/sessions — active sessions (admin view) ─────────────────────

router.get("/:id/sessions", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  if (!appRepo.findById(db, appId)) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const sessions = appSessionRepo.listActiveForApp(db, appId);
  res.json({ count: sessions.length, results: sessions });
});

// ── DELETE /apps/:id/sessions/:sessionId — admin revoke ───────────────────────

router.delete("/:id/sessions/:sessionId", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  const sessionId = param(param(req.params["sessionId"]));
  const row = appSessionRepo.findById(db, sessionId);
  if (!row || row.app_id !== appId) { res.status(404).json({ error: "Session not found", code: "NOT_FOUND" }); return; }
  appSessionRepo.revoke(db, sessionId);
  res.json({ success: true });
});

// ── App users (gateway auth directory — per app, disjoint from dashboard users)

router.get("/:id/users", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  if (!appRepo.findById(db, appId)) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const users = appUserRepo.listByApp(db, appId);
  res.json({ count: users.length, results: users });
});

router.post("/:id/users", requirePermission("manage:apps"), async (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  if (!appRepo.findById(db, appId)) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const { username, email, password, sub, display_name } = req.body ?? {};
  if (!username || !email || !password) {
    res.status(400).json({ error: "username, email and password are required (sub is optional — defaults to the username)", code: "VALIDATION_ERROR" }); return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters", code: "WEAK_PASSWORD" }); return;
  }
  try {
    const user = await appUserRepo.create(db, { app_id: appId, username, email, password, sub, display_name });
    res.status(201).json(user);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "A user with this username or email already exists for this app", code: "DUPLICATE_APP_USER" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/:id/users/:userId", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  const userId = param(param(req.params["userId"]));
  const users = appUserRepo.listByApp(db, appId);
  if (!users.find(u => u.id === userId)) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const { display_name, email, sub, is_active } = req.body ?? {};
  try {
    if (display_name !== undefined || email !== undefined || sub !== undefined) {
      appUserRepo.update(db, userId, { display_name, email, sub });
    }
    if (is_active !== undefined) appUserRepo.setActive(db, userId, Boolean(is_active));
    res.json(appUserRepo.listByApp(db, appId).find(u => u.id === userId));
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Email already in use for this app", code: "DUPLICATE_APP_USER" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/:id/users/:userId/password", requirePermission("manage:apps"), async (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  const userId = param(param(req.params["userId"]));
  if (!appUserRepo.listByApp(db, appId).find(u => u.id === userId)) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const { password } = req.body ?? {};
  if (!password || String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters", code: "WEAK_PASSWORD" }); return;
  }
  await appUserRepo.setPassword(db, userId, password);
  // Security: password reset kills every active session for this user on this app
  appSessionRepo.revokeAllForAppUser(db, appId, appUserRepo.listByApp(db, appId).find(u => u.id === userId)!.sub);
  res.json({ success: true });
});

router.delete("/:id/users/:userId", requirePermission("manage:apps"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  const userId = param(param(req.params["userId"]));
  const user = appUserRepo.listByApp(db, appId).find(u => u.id === userId);
  if (!user) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  appSessionRepo.revokeAllForAppUser(db, appId, user.sub);
  appUserRepo.delete(db, userId);
  res.json({ success: true });
});

// ── GET /apps/:id/export ───────────────────────────────────────────────────────
// Query params:
//   include = comma-separated list of "endpoints","scripts","bots"  (default: endpoints,scripts)
//   env     = "none" | "keys" | "values"                            (default: "keys")
//
// "bots" includes the AI bot(s) bound to this app (one bot per app by uniqueness
// rule) plus the AI provider definitions those bots reference. Provider API keys
// live in the secret vault — they are NEVER exported; providers export with the
// secret NAME and the import links (or asks for) the secret on the target.

router.get("/:id/export", requirePermission("export:app"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));

  const app = appRepo.findById(db, appId);
  if (!app) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  const includeRaw = String(req.query["include"] ?? "endpoints,scripts");
  const include = new Set(includeRaw.split(",").map(s => s.trim()).filter(Boolean));
  const envMode = (["none", "keys", "values"].includes(String(req.query["env"])) ? req.query["env"] : "keys") as "none" | "keys" | "values";

  // ── Resolve app_env ────────────────────────────────────────────────────────
  let exportedEnv: Array<{ key: string; value_type: string; plain_value?: string }> = [];
  if (envMode !== "none") {
    for (const e of app.app_env ?? []) {
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
    const endpoints = endpointRepo.findByAppId(db, appId);

    // Build script_id → filename map (needed even if scripts not included)
    const scriptIdToFilename = new Map(
      scriptRepo.findByAppId(db, appId).map((s: any) => [s.id, s.filename])
    );

    for (const ep of endpoints) {
      const { id: _id, app_id: _aid, created_at: _c, updated_at: _u, ...rest } = ep as any;

      // Resolve secret_ref id → secret name in upstream.auth_config
      let upstream = { ...(rest.upstream ?? {}) };
      if (upstream.auth_config?.secret_ref) {
        const secret = secretRepo.findById(db, String(upstream.auth_config.secret_ref));
        upstream = {
          ...upstream,
          auth_config: {
            ...upstream.auth_config,
            secret_ref: undefined,
            secret_ref_name: secret?.name ?? null,
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
    exportedScripts = scriptRepo.findByAppId(db, appId).map((s: any) => ({
      filename:    s.filename,
      language:    s.language,
      source:      s.source,
      description: s.description,
      folder:      s.folder ?? null,
    }));
  }

  // ── App fields ─────────────────────────────────────────────────────────────
  const { id: _id, created_by: _cb, created_at: _ca, updated_at: _ua, ...appRest } = app as any;
  const slug = (appRest.base_path as string).replace(/\//g, "-").replace(/^-/, "") || "app";

  // ── Bots + AI providers (shared bot transfer format) ───────────────────────
  let botBundle: ReturnType<typeof buildBotBundle> | null = null;
  if (include.has("bots")) {
    const botsForApp = aiBotRepo.listSafe(db).filter(b => b.allowed_app_ids.includes(String(appId)));
    botBundle = buildBotBundle(db, botsForApp);
  }

  const payload = {
    export_version:  "1",
    kind:            "app",
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
    ...(botBundle ? { bots: botBundle.bots, ai_providers: botBundle.ai_providers } : {}),
  };

  const filename = `${slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.json(payload);
});

// ── POST /apps/import ──────────────────────────────────────────────────────────
// Body: { payload: AppExport, options?: { name?, base_path?, overwrite? } }

router.post("/import", requirePermission("manage:apps"), async (req, res) => {
  const db = getDb();
  const { payload, options = {} } = req.body ?? {};

  if (!payload || payload.export_version !== "1") {
    res.status(400).json({ error: "Unsupported or missing export_version — only version 1 is supported", code: "UNSUPPORTED_EXPORT_VERSION" });
    return;
  }

  const warnings: string[] = [];
  const createdBotIds: string[] = [];
  const targetName     = options.name      ?? payload.app.name;
  const targetBasePath = options.base_path ?? payload.app.base_path;

  // ── Conflict check ─────────────────────────────────────────────────────────
  const existing = appRepo.findByBasePath(db, targetBasePath);
  if (existing) {
    if (!options.overwrite) {
      res.status(409).json({ error: "An app with this base_path already exists", code: "DUPLICATE_BASE_PATH", conflict: true, existing_app_id: existing.id });
      return;
    }
    // overwrite: true — delete existing app + its data
    // Unbind any bot bound to the existing app first (bot itself survives — it
    // may be bound to other apps; dangling app bindings must not remain)
    for (const b of aiBotRepo.listSafe(db).filter(x => x.allowed_app_ids.includes(String(existing.id)))) {
      aiBotRepo.updateOneAppPermission(db, b.id, String(existing.id), { read: false, write: false });
      warnings.push(`Bot '${b.name}' was unbound from the overwritten app — re-bind it manually if it should serve the imported app.`);
    }
    endpointRepo.deleteByAppId(db, existing.id);
    scriptRepo.deleteByAppId(db, existing.id);
    versionHistoryRepo.deleteByAppId(db, existing.id);
    appRepo.delete(db, existing.id);
  }

  // ── Create app ─────────────────────────────────────────────────────────────
  const { allowed_provider_ids: _providers, ...appFields } = payload.app;
  const newApp = appRepo.create(db, {
    ...appFields,
    name:                 targetName,
    base_path:            targetBasePath,
    status:               "draft",
    allowed_provider_ids: [],
    created_by:           req.dashboardUser?.id ?? null,
  });
  const newAppId = newApp.id;
  warnings.push("OIDC providers were not restored — provider IDs are instance-specific and cannot transfer between instances. Go to App Settings → Identity Providers and re-link the providers that should be allowed to authenticate against this app. Until then, all configured providers on this instance can access it.");

  try {
    // ── Create scripts + build filename → new id map ─────────────────────────
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
      const script = scriptRepo.create(db, {
        app_id:      newAppId,
        filename,
        language:    s.language,
        source:      s.source,
        compiled,
        description: s.description ?? "",
        folder:      s.folder ?? null,
      });
      filenameToId.set(filename, script.id);
      scriptsCreated++;
    }

    // ── Create endpoints ───────────────────────────────────────────────────────
    let endpointsCreated = 0;

    for (const ep of payload.endpoints ?? []) {
      const { script_file_id: _sfid, script_filename, upstream: epUpstream, ...epRest } = ep as any;

      // Resolve script_filename → new script id
      const resolvedScriptId = script_filename ? (filenameToId.get(script_filename) ?? null) : null;
      if (script_filename && !resolvedScriptId) {
        warnings.push(`Endpoint '${epRest.name}' references script '${script_filename}' but that script was not included in this export file. The endpoint was created with no script assigned — go to the endpoint's Script tab and re-assign the correct script.`);
      }

      // Resolve secret_ref_name → secret id
      let upstream = { ...(epUpstream ?? {}) };
      if (upstream.auth_config?.secret_ref_name) {
        const secretName = upstream.auth_config.secret_ref_name;
        const secret = secretRepo.findByName(db, secretName);
        if (!secret) {
          warnings.push(`Endpoint '${epRest.name}' uses secret '${secretName}' for upstream authentication, but no secret with that name exists on this instance. The endpoint was imported with auth disabled (secret_ref: null). Go to Admin → Secrets, create a secret named '${secretName}', then re-link it in the endpoint's Upstream tab under Auth Config.`);
          upstream = { ...upstream, auth_config: { ...upstream.auth_config, secret_ref_name: undefined, secret_ref: null } };
        } else {
          upstream = { ...upstream, auth_config: { ...upstream.auth_config, secret_ref_name: undefined, secret_ref: secret.id } };
        }
      }

      endpointRepo.create(db, {
        ...epRest,
        app_id:         newAppId,
        upstream,
        script_file_id: resolvedScriptId,
      });
      endpointsCreated++;
    }

    // ── Bots + AI providers (shared bot transfer format) ──────────────────────
    // Providers are matched/created by name (API keys never travel — providers
    // link by secret name). Bots are created with FRESH keys (returned once in
    // bot_keys). App bindings resolve by base_path: the imported app matches
    // the bundle's own base_path; other apps must already exist here.
    const providerNameToId = importProviders(db, (payload as any).ai_providers, warnings, req.dashboardUser?.id);

    const appBasePaths = new Map<string, string>();
    for (const a of appRepo.list(db)) appBasePaths.set(a.base_path, a.id);
    appBasePaths.set(targetBasePath, newAppId); // the freshly imported app wins

    const { created: createdBots, botIds } = await importBotBundle(
      db,
      (payload as any).bots,
      providerNameToId,
      (bp: string) => appBasePaths.get(bp) ?? null,
      warnings,
      req.dashboardUser?.id
    );
    createdBotIds.push(...botIds);

    // ── Finalise ───────────────────────────────────────────────────────────────
    refreshApp(newAppId);
    writeHistory(newAppId, "imported", `App imported: ${targetName} (from export file)`, req);

    res.status(201).json({
      app: newApp,
      endpoints_created: endpointsCreated,
      scripts_created:   scriptsCreated,
      bots_created:      createdBots.length,
      bot_keys:          createdBots,
      warnings,
    });
  } catch (err: any) {
    // Rollback — delete the partially-created app so no phantom remains
    for (const botId of createdBotIds) aiBotRepo.delete(db, botId);
    endpointRepo.deleteByAppId(db, newAppId);
    scriptRepo.deleteByAppId(db, newAppId);
    appRepo.delete(db, newAppId);
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: "Import failed — conflicting data (duplicate endpoint method + path in export file)", code: "DUPLICATE_ENDPOINT" });
      return;
    }
    res.status(500).json({ error: err.message ?? "Import failed — rolled back", code: "INTERNAL_ERROR" });
  }
});

// ── GET /apps/:id/history ──────────────────────────────────────────────────────

router.get("/:id/history", (req, res) => {
  const history = versionHistoryRepo.findByAppId(getDb(), param(param(req.params["id"])));
  res.json({ count: history.length, results: history });
});

// ── POST /apps/:id/rollback ────────────────────────────────────────────────────

router.post("/:id/rollback", requirePermission("rollback"), (req, res) => {
  const db = getDb();
  const appId = param(param(req.params["id"]));
  const { snapshot_id } = req.body ?? {};

  const snapshot = versionHistoryRepo.findById(db, snapshot_id);
  if (!snapshot || snapshot.app_id !== appId) {
    res.status(404).json({ error: "Snapshot not found", code: "NOT_FOUND" });
    return;
  }

  endpointRepo.deleteByAppId(db, appId);
  for (const ep of (snapshot.snapshot as any)?.endpoints ?? []) {
    const { id: _id, app_id: _aid, created_at: _c, updated_at: _u, ...rest } = ep as any;
    endpointRepo.create(db, { ...rest, app_id: appId });
  }
  appRepo.update(db, appId, (snapshot.snapshot as any)?.app ?? {});
  refreshApp(appId);
  writeHistory(appId, "rollback", `Rolled back to snapshot from ${new Date(snapshot.created_at).toLocaleString()}`, req);
  res.json({ success: true });
});

export default router;
