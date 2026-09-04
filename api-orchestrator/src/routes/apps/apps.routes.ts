import { param } from "../../utils/params.js";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { appRepo } from "../../db/repos/appRepo.js";
import { endpointRepo } from "../../db/repos/endpointRepo.js";
import { scriptRepo } from "../../db/repos/scriptRepo.js";
import { versionHistoryRepo } from "../../db/repos/versionHistoryRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshApp } from "../../cache/appCache.js";

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

router.get("/:id/history", (req, res) => {
  const history = versionHistoryRepo.findByAppId(getDb(), param(param(req.params["id"])));
  res.json({ count: history.length, results: history });
});

router.post("/:id/rollback", requirePermission("rollback"), (req, res) => {
  const db = getDb();
  const { snapshot_id } = req.body ?? {};
  const snap = versionHistoryRepo.findById(db, snapshot_id);
  if (!snap || snap.app_id !== param(param(req.params["id"]))) { res.status(404).json({ error: "Snapshot not found", code: "NOT_FOUND" }); return; }

  const appId = param(param(req.params["id"]));
  endpointRepo.deleteByAppId(db, appId);
  for (const ep of snap.snapshot.endpoints as any[]) {
    const { id: _id, app_id: _a, created_at: _c, updated_at: _u, ...rest } = ep;
    endpointRepo.create(db, { ...rest, app_id: appId });
  }
  appRepo.update(db, appId, snap.snapshot.app as any);
  refreshApp(appId);
  writeHistory(appId, "rollback", `Rolled back to snapshot from ${snap.created_at}`, req);
  res.json({ success: true });
});

export default router;
