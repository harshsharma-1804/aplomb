import { Router } from "express";
import { Secret } from "../../models/Secret.js";
import { requirePermission } from "../../auth/rbac.js";
import { encryptSecret } from "../../secrets/resolver.js";

const MASKED = "••••••••";

const router = Router();

// ── GET /admin/secrets ─────────────────────────────────────────────────────────
// Returns metadata only — ciphertext, iv, auth_tag are never returned.

router.get("/", requirePermission("manage:secrets"), async (_req, res) => {
  const secrets = await Secret.find().select("-ciphertext -iv -auth_tag").lean();
  res.json({
    count: secrets.length,
    results: secrets.map((s) => ({ ...s, value: MASKED })),
  });
});

// ── POST /admin/secrets ────────────────────────────────────────────────────────

router.post("/", requirePermission("manage:secrets"), async (req, res) => {
  const { name, description, value } = req.body ?? {};
  if (!name || !value) {
    res.status(400).json({ error: "name and value are required", code: "VALIDATION_ERROR" });
    return;
  }

  try {
    const encrypted = encryptSecret(value);
    const secret = await Secret.create({
      name,
      description: description ?? "",
      ...encrypted,
      created_by: req.dashboardUser?.id,
    });
    res.status(201).json({
      id: secret._id,
      name: secret.name,
      description: secret.description,
      value: MASKED,
    });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Secret name already exists", code: "DUPLICATE_SECRET" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── POST /admin/secrets/:id/rotate ────────────────────────────────────────────

router.post("/:id/rotate", requirePermission("manage:secrets"), async (req, res) => {
  const { value } = req.body ?? {};
  if (!value) {
    res.status(400).json({ error: "value is required", code: "VALIDATION_ERROR" });
    return;
  }

  const encrypted = encryptSecret(value);
  const secret = await Secret.findByIdAndUpdate(
    req.params["id"],
    { ...encrypted, rotated_at: new Date() },
    { new: true }
  ).lean();

  if (!secret) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  res.json({
    id: secret._id,
    name: secret.name,
    rotated_at: secret.rotated_at,
    value: MASKED,
  });
});

// ── DELETE /admin/secrets/:id ──────────────────────────────────────────────────

router.delete("/:id", requirePermission("manage:secrets"), async (req, res) => {
  await Secret.findByIdAndDelete(req.params["id"]);
  res.json({ success: true });
});

export default router;
