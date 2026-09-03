import { Router } from "express";
import { IdentityProvider } from "../../models/IdentityProvider.js";
import { requirePermission } from "../../auth/rbac.js";

const router = Router();

// ── GET /admin/identity-providers ─────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const providers = await IdentityProvider.find().lean();
  res.json({ count: providers.length, results: providers });
});

// ── POST /admin/identity-providers ────────────────────────────────────────────

router.post("/", requirePermission("manage:providers"), async (req, res) => {
  try {
    const provider = await IdentityProvider.create({
      ...req.body,
      created_by: req.dashboardUser?.id,
    });
    res.status(201).json(provider);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Issuer already exists", code: "DUPLICATE_ISSUER" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── GET /admin/identity-providers/:id ─────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const provider = await IdentityProvider.findById(req.params["id"]).lean();
  if (!provider) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(provider);
});

// ── PUT /admin/identity-providers/:id ─────────────────────────────────────────

router.put("/:id", requirePermission("manage:providers"), async (req, res) => {
  const provider = await IdentityProvider.findByIdAndUpdate(
    req.params["id"],
    req.body,
    { new: true }
  ).lean();
  if (!provider) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(provider);
});

// ── DELETE /admin/identity-providers/:id ──────────────────────────────────────

router.delete("/:id", requirePermission("manage:providers"), async (req, res) => {
  await IdentityProvider.findByIdAndDelete(req.params["id"]);
  res.json({ success: true });
});

export default router;
