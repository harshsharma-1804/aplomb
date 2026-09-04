import { Router } from "express";
import { getDb } from "../../db/client.js";
import { organizationRepo } from "../../db/repos/organizationRepo.js";
import { requirePermission } from "../../auth/rbac.js";

const router = Router();

router.get("/", (_req, res) => {
  const org = organizationRepo.get(getDb());
  if (!org) { res.status(404).json({ error: "Organization not found", code: "NOT_FOUND" }); return; }
  res.json(org);
});

router.put("/", requirePermission("manage:users"), (req, res) => {
  const { name, slug } = req.body ?? {};
  try {
    const org = organizationRepo.update(getDb(), { name, slug });
    if (!org) { res.status(404).json({ error: "Organization not found", code: "NOT_FOUND" }); return; }
    res.json(org);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Slug already taken", code: "DUPLICATE_SLUG" }); return; }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
