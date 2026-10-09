import { param } from "../../utils/params.js";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { identityProviderRepo } from "../../db/repos/identityProviderRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshProviderCache } from "../../cache/providerCache.js";

const router = Router();

router.get("/", (_req, res) => {
  const providers = identityProviderRepo.list(getDb());
  res.json({ count: providers.length, results: providers });
});

router.post("/", requirePermission("manage:providers"), (req, res) => {
  try {
    const provider = identityProviderRepo.create(getDb(), { ...req.body, created_by: req.dashboardUser?.id });
    refreshProviderCache();
    res.status(201).json(provider);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "A provider with this issuer and client ID combination already exists", code: "DUPLICATE_PROVIDER" }); return; }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.get("/:id", (req, res) => {
  const provider = identityProviderRepo.findById(getDb(), param(param(req.params["id"])));
  if (!provider) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(provider);
});

router.put("/:id", requirePermission("manage:providers"), (req, res) => {
  const provider = identityProviderRepo.update(getDb(), param(param(req.params["id"])), req.body);
  if (!provider) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  refreshProviderCache();
  res.json(provider);
});

router.delete("/:id", requirePermission("manage:providers"), (req, res) => {
  identityProviderRepo.delete(getDb(), param(param(req.params["id"])));
  refreshProviderCache();
  res.json({ success: true });
});

export default router;
