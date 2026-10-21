import { Router } from "express";
import { getDb } from "../../db/client.js";
import { organizationRepo } from "../../db/repos/organizationRepo.js";
import { requirePermission } from "../../auth/rbac.js";

const router = Router();

const VALID_THEMES   = new Set(["light", "dark", "system"]);
const VALID_PALETTES = new Set(["current", "coastal", "monochrome", "orchid"]);

router.get("/", (_req, res) => {
  const org = organizationRepo.get(getDb());
  if (!org) { res.status(404).json({ error: "Organization not found", code: "NOT_FOUND" }); return; }
  res.json(org);
});

router.put("/", requirePermission("manage:users"), (req, res) => {
  const { name, slug, appearance } = req.body ?? {};
  if (appearance !== undefined && (typeof appearance !== "object" || appearance === null || Array.isArray(appearance))) {
    res.status(400).json({ error: "appearance must be an object", code: "VALIDATION_ERROR" }); return;
  }
  if (appearance?.theme !== undefined && !VALID_THEMES.has(appearance.theme)) {
    res.status(400).json({ error: `appearance.theme must be one of: ${[...VALID_THEMES].join(", ")}`, code: "VALIDATION_ERROR" }); return;
  }
  if (appearance?.palette !== undefined && !VALID_PALETTES.has(appearance.palette)) {
    res.status(400).json({ error: `appearance.palette must be one of: ${[...VALID_PALETTES].join(", ")}`, code: "VALIDATION_ERROR" }); return;
  }
  try {
    const org = organizationRepo.update(getDb(), { name, slug, appearance });
    if (!org) { res.status(404).json({ error: "Organization not found", code: "NOT_FOUND" }); return; }
    res.json(org);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Slug already taken", code: "DUPLICATE_SLUG" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
