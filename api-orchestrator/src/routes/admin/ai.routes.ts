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
  const { name, base_url, model, api_key, is_active } = req.body ?? {};
  if (!name || !base_url || !model || !api_key) {
    res.status(400).json({ error: "name, base_url, model and api_key are required", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const provider = aiProviderRepo.create(getDb(), { name, base_url, model, api_key, is_active, created_by: (req as any).dashboardUser?.id });
    refreshToolRegistry();
    res.status(201).json(provider);
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/providers/:id", requirePermission("manage:providers"), (req, res) => {
  const { name, base_url, model, api_key, is_active } = req.body ?? {};
  const updated = aiProviderRepo.update(getDb(), String(req.params["id"]), { name, base_url, model, api_key, is_active });
  if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  refreshToolRegistry();
  res.json(updated);
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
  const { is_active } = req.body ?? {};
  if (typeof is_active !== "boolean") {
    res.status(400).json({ error: "is_active (boolean) is required", code: "VALIDATION_ERROR" });
    return;
  }
  const updated = aiBotRepo.setActive(getDb(), String(req.params["id"]), is_active);
  if (!updated) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(updated);
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
