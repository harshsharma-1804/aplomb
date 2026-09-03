import { Router } from "express";
import { Organization } from "../../models/Organization.js";
import { requirePermission } from "../../auth/rbac.js";

const router = Router();

// ── GET /__config/admin/organization ──────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const org = await Organization.findById(orgId).lean();
    if (!org) { res.status(404).json({ error: "Organization not found", code: "NOT_FOUND" }); return; }
    res.json(org);
  } catch {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── PUT /__config/admin/organization ──────────────────────────────────────────

router.put("/", requirePermission("manage:users"), async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const { name, slug } = req.body ?? {};
    const org = await Organization.findByIdAndUpdate(
      orgId,
      { $set: { ...(name && { name }), ...(slug && { slug }) } },
      { new: true }
    ).lean();
    if (!org) { res.status(404).json({ error: "Organization not found", code: "NOT_FOUND" }); return; }
    res.json(org);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Slug already taken", code: "DUPLICATE_SLUG" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
