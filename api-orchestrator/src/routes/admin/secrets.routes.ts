import { param } from "../../utils/params.js";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { secretRepo } from "../../db/repos/secretRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { encryptSecret } from "../../secrets/resolver.js";

const MASKED = "••••••••";
const router = Router();

router.get("/", requirePermission("manage:secrets"), (_req, res) => {
  const list = secretRepo.list(getDb());
  res.json({ count: list.length, results: list.map(s => ({ ...s, value: MASKED })) });
});

router.post("/", requirePermission("manage:secrets"), (req, res) => {
  const { name, description, value } = req.body ?? {};
  if (!name || !value) { res.status(400).json({ error: "name and value are required", code: "VALIDATION_ERROR" }); return; }
  try {
    const encrypted = encryptSecret(value);
    const secret = secretRepo.create(getDb(), { name, description: description ?? "", ...encrypted, created_by: req.dashboardUser?.id });
    res.status(201).json({ id: secret.id, name: secret.name, description: secret.description, value: MASKED });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Secret name already exists", code: "DUPLICATE_SECRET" }); return; }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.post("/:id/rotate", requirePermission("manage:secrets"), (req, res) => {
  const { value } = req.body ?? {};
  if (!value) { res.status(400).json({ error: "value is required", code: "VALIDATION_ERROR" }); return; }
  const secret = secretRepo.findById(getDb(), param(param(req.params["id"])));
  if (!secret) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  const encrypted = encryptSecret(value);
  secretRepo.rotate(getDb(), param(param(req.params["id"])), encrypted);
  const updated = secretRepo.findById(getDb(), param(param(req.params["id"])))!;
  res.json({ id: updated.id, name: updated.name, rotated_at: updated.rotated_at, value: MASKED });
});

router.delete("/:id", requirePermission("manage:secrets"), (req, res) => {
  secretRepo.delete(getDb(), param(param(req.params["id"])));
  res.json({ success: true });
});

export default router;
