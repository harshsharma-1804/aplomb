import { Router } from "express";
import { App } from "../../models/App.js";
import { param } from "../../utils/params.js";
import { Endpoint } from "../../models/Endpoint.js";
import { VersionHistory } from "../../models/VersionHistory.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshApp } from "../../cache/appCache.js";

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
