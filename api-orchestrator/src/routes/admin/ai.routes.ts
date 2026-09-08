import { Router } from "express";
import { getDb } from "../../db/client.js";
import { aiProviderRepo } from "../../db/repos/aiProviderRepo.js";
import { aiBotRepo } from "../../db/repos/aiBotRepo.js";
import { aiToolCallRepo } from "../../db/repos/aiToolCallRepo.js";
import { refreshToolRegistry } from "../../ai/toolRegistry.js";
import { requirePermission } from "../../auth/rbac.js";

const router = Router();

// ── AI Providers (admin-managed LLM config) ──────────────────────────────────

router.get("/providers", requirePermission("manage:providers"), (req, res) => {
  const providers = aiProviderRepo.listSafe(getDb());
  res.json({ count: providers.length, results: providers });
});

router.post("/providers", requirePermission("manage:providers"), (req, res) => {
  const { name, base_url, model, api_key, secret_id, is_active } = req.body ?? {};
  if (!name || !base_url || !model) {
    res.status(400).json({ error: "name, base_url and model are required", code: "VALIDATION_ERROR" });
    return;
  }
  if (!api_key && !secret_id) {
    res.status(400).json({ error: "Provide either api_key or secret_id (vault reference)", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const provider = aiProviderRepo.create(getDb(), { name, base_url, model, api_key, secret_id, is_active, created_by: (req as any).dashboardUser?.id });
    refreshToolRegistry();
    res.status(201).json(provider);
  } catch (e: any) {
    if (e.message?.includes("not found in vault")) {
      res.status(400).json({ error: e.message, code: "SECRET_NOT_FOUND" });
      return;
    }
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/providers/:id", requirePermission("manage:providers"), (req, res) => {
  const { name, base_url, model, api_key, secret_id, is_active } = req.body ?? {};
  try {
    const updated = aiProviderRepo.update(getDb(), String(req.params["id"]), { name, base_url, model, api_key, secret_id, is_active });
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    refreshToolRegistry();
    res.json(updated);
  } catch (e: any) {
    if (e.message?.includes("not found in vault")) {
      res.status(400).json({ error: e.message, code: "SECRET_NOT_FOUND" });
      return;
    }
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/providers/:id", requirePermission("manage:providers"), (req, res) => {
  aiProviderRepo.delete(getDb(), String(req.params["id"]));
  refreshToolRegistry();
  res.json({ success: true });
});

// ── AI Bots (registered chatbot clients) ─────────────────────────────────────

router.get("/bots", requirePermission("manage:providers"), (req, res) => {
  const bots = aiBotRepo.listSafe(getDb());
  res.json({ count: bots.length, results: bots });
});

// API key is returned ONCE in this response — never retrievable afterwards.
router.post("/bots", requirePermission("manage:providers"), async (req, res) => {
  const { name } = req.body ?? {};
  if (!name?.trim()) {
    res.status(400).json({ error: "name is required", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const { bot, api_key } = await aiBotRepo.create(getDb(), { name, created_by: (req as any).dashboardUser?.id });
    res.status(201).json({ ...bot, api_key });
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/bots/:id", requirePermission("manage:providers"), (req, res) => {
  const { is_active, allowed_app_ids, allowed_provider_ids } = req.body ?? {};

  if (is_active !== undefined) {
    if (typeof is_active !== "boolean") {
      res.status(400).json({ error: "is_active must be a boolean", code: "VALIDATION_ERROR" });
      return;
    }
    const updated = aiBotRepo.setActive(getDb(), String(req.params["id"]), is_active);
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    res.json(updated);
    return;
  }

  if (allowed_app_ids !== undefined || allowed_provider_ids !== undefined) {
    for (const [field, val] of [["allowed_app_ids", allowed_app_ids], ["allowed_provider_ids", allowed_provider_ids]] as const) {
      if (val !== undefined && (!Array.isArray(val) || !val.every(v => typeof v === "string"))) {
        res.status(400).json({ error: `${field} must be an array of strings`, code: "VALIDATION_ERROR" });
        return;
      }
    }
    const updated = aiBotRepo.updateBindings(getDb(), String(req.params["id"]), { allowed_app_ids, allowed_provider_ids });
    if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    res.json(updated);
    return;
  }

  res.status(400).json({ error: "Nothing to update — send is_active, allowed_app_ids or allowed_provider_ids", code: "VALIDATION_ERROR" });
});

router.delete("/bots/:id", requirePermission("manage:providers"), (req, res) => {
  aiBotRepo.delete(getDb(), String(req.params["id"]));
  res.json({ success: true });
});

// ── Tool call audit log ───────────────────────────────────────────────────────

router.get("/tool-calls", requirePermission("manage:providers"), (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "100"), 10) || 100, 500);
  const calls = aiToolCallRepo.recent(getDb(), limit);
  res.json({ count: calls.length, results: calls });
});

export default router;
