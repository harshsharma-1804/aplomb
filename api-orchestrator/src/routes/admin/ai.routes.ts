import { Router } from "express";
import { getDb } from "../../db/client.js";
import { aiProviderRepo } from "../../db/repos/aiProviderRepo.js";
import { aiBotRepo } from "../../db/repos/aiBotRepo.js";
import { aiToolCallRepo } from "../../db/repos/aiToolCallRepo.js";
import { refreshToolRegistry } from "../../ai/toolRegistry.js";
import { requirePermission } from "../../auth/rbac.js";

const router = Router();

// ── AI Providers ──────────────────────────────────────────────────────────────

router.get("/providers", requirePermission("manage:providers"), (req, res) => {
  res.json({ count: 0, results: aiProviderRepo.listSafe(getDb()) });
});

router.post("/providers", requirePermission("manage:providers"), (req, res) => {
  const { name, base_url, model, secret_id, no_auth, is_active } = req.body ?? {};
  if (!name || !base_url || !model) {
    res.status(400).json({ error: "name, base_url and model are required", code: "VALIDATION_ERROR" }); return;
  }
  if (!secret_id && !no_auth) {
    res.status(400).json({ error: "Provide secret_id (vault reference) or set no_auth: true for local/open models", code: "VALIDATION_ERROR" }); return;
  }
  try {
    const provider = aiProviderRepo.create(getDb(), { name, base_url, model, secret_id: no_auth ? null : secret_id, is_active, created_by: (req as any).dashboardUser?.id });
    refreshToolRegistry();
    res.status(201).json(provider);
  } catch (e: any) {
    if (e.message?.includes("not found in vault")) { res.status(400).json({ error: e.message, code: "SECRET_NOT_FOUND" }); return; }
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/providers/:id", requirePermission("manage:providers"), (req, res) => {
  const { name, base_url, model, secret_id, is_active } = req.body ?? {};
  try {
    const updated = aiProviderRepo.update(getDb(), String(req.params["id"]), { name, base_url, model, secret_id, is_active });
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    refreshToolRegistry();
    res.json(updated);
  } catch (e: any) {
    if (e.message?.includes("not found in vault")) { res.status(400).json({ error: e.message, code: "SECRET_NOT_FOUND" }); return; }
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/providers/:id", requirePermission("manage:providers"), (req, res) => {
  aiProviderRepo.delete(getDb(), String(req.params["id"]));
  refreshToolRegistry();
  res.json({ success: true });
});

// ── AI Bots ───────────────────────────────────────────────────────────────────

router.get("/bots", requirePermission("manage:providers"), (req, res) => {
  const bots = aiBotRepo.listSafe(getDb());
  res.json({ count: bots.length, results: bots });
});

router.get("/bots/:id", requirePermission("manage:providers"), (req, res) => {
  const bot = aiBotRepo.findById(getDb(), String(req.params["id"]));
  if (!bot) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(bot);
});

router.post("/bots", requirePermission("manage:providers"), async (req, res) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) { res.status(400).json({ error: "name is required", code: "VALIDATION_ERROR" }); return; }
  try {
    const { bot, api_key } = await aiBotRepo.create(getDb(), { name, created_by: (req as any).dashboardUser?.id });
    res.status(201).json({ ...bot, api_key });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/bots/:id", requirePermission("manage:providers"), (req, res) => {
  const id = String(req.params["id"]);
  const { is_active, allowed_app_ids, allowed_provider_ids, app_permissions, rules, persona, limits } = req.body ?? {};

  // ── active toggle ────────────────────────────────────────────────────────────
  if (is_active !== undefined) {
    if (typeof is_active !== "boolean") { res.status(400).json({ error: "is_active must be a boolean", code: "VALIDATION_ERROR" }); return; }
    const updated = aiBotRepo.setActive(getDb(), id, is_active);
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    res.json(updated); return;
  }

  // ── bindings ─────────────────────────────────────────────────────────────────
  if (app_permissions !== undefined) {
    if (typeof app_permissions !== "object" || Array.isArray(app_permissions)) {
      res.status(400).json({ error: "app_permissions must be an object", code: "VALIDATION_ERROR" }); return;
    }
    try {
      const updated = aiBotRepo.updateAppPermissions(getDb(), id, app_permissions);
      if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
      res.json(updated);
    } catch (e: any) {
      if (e.code === "APP_ALREADY_ASSIGNED") { res.status(409).json({ error: e.message, code: e.code }); return; }
      res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
    }
    return;
  }

  if (allowed_provider_ids !== undefined) {
    if (!Array.isArray(allowed_provider_ids) || !allowed_provider_ids.every(v => typeof v === "string")) {
      res.status(400).json({ error: "allowed_provider_ids must be an array of strings", code: "VALIDATION_ERROR" }); return;
    }
    try {
      const updated = aiBotRepo.updateBindings(getDb(), id, { allowed_provider_ids });
      if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
    }
    return;
  }

  // ── rules + persona ───────────────────────────────────────────────────────────
  if (rules !== undefined || persona !== undefined) {
    if (rules !== undefined && (!Array.isArray(rules) || !rules.every(r => typeof r === "string"))) {
      res.status(400).json({ error: "rules must be an array of strings", code: "VALIDATION_ERROR" }); return;
    }
    try {
      const updated = aiBotRepo.updateRules(getDb(), id, rules ?? [], persona ?? "");
      if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
      res.json(updated);
    } catch (e: any) { res.status(400).json({ error: e.message, code: "VALIDATION_ERROR" }); }
    return;
  }

  // ── limits ────────────────────────────────────────────────────────────────────
  if (limits !== undefined) {
    if (typeof limits !== "object" || Array.isArray(limits)) {
      res.status(400).json({ error: "limits must be an object", code: "VALIDATION_ERROR" }); return;
    }
    const updated = aiBotRepo.updateLimits(getDb(), id, limits);
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    res.json(updated); return;
  }

  res.status(400).json({ error: "Nothing to update — send is_active, app_permissions, allowed_provider_ids, rules, persona or limits", code: "VALIDATION_ERROR" });
});

router.put("/bots/:id/apps/:appId/permissions", requirePermission("manage:providers"), (req, res) => {
  const { read, write } = req.body ?? {};
  if (typeof read !== "boolean" || typeof write !== "boolean") {
    res.status(400).json({ error: "read and write (boolean) are required", code: "VALIDATION_ERROR" }); return;
  }
  try {
    const updated = aiBotRepo.updateOneAppPermission(getDb(), String(req.params["id"]), String(req.params["appId"]), { read, write });
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    res.json(updated);
  } catch (e: any) {
    if (e.code === "APP_ALREADY_ASSIGNED") { res.status(409).json({ error: e.message, code: e.code }); return; }
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/bots/:id", requirePermission("manage:providers"), (req, res) => {
  aiBotRepo.delete(getDb(), String(req.params["id"]));
  res.json({ success: true });
});

// ── Tool call audit ───────────────────────────────────────────────────────────

router.get("/tool-calls", requirePermission("manage:providers"), (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500);
  const botId = req.query["bot_id"] ? String(req.query["bot_id"]) : undefined;
  const calls = aiToolCallRepo.recent(getDb(), limit, botId);
  res.json({ count: calls.length, results: calls });
});

export default router;
