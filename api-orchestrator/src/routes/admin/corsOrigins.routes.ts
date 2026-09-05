import { Router } from "express";
import { getDb } from "../../db/client.js";
import { corsOriginRepo } from "../../db/repos/corsOriginRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshCorsCache } from "../../cache/corsCache.js";

const router = Router();

function parseOrigin(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "*") return "*";
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

router.get("/", (req, res) => {
  try {
    const entries = corsOriginRepo.list(getDb());
    res.json({ count: entries.length, results: entries });
  } catch {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.post("/", requirePermission("manage:users"), (req, res) => {
  const { origin: raw, description } = req.body ?? {};
  if (!raw) {
    res.status(400).json({ error: "origin is required", code: "VALIDATION_ERROR" });
    return;
  }

  const parsed = parseOrigin(raw);
  if (!parsed) {
    res.status(400).json({
      error: `"${raw}" is not a valid origin. Use full scheme+host format: https://myapp.com or *`,
      code: "INVALID_ORIGIN",
    });
    return;
  }

  try {
    const entry = corsOriginRepo.create(getDb(), {
      origin: parsed,
      description: description ?? "",
      created_by: (req as any).dashboardUser?.id ?? null,
    });
    refreshCorsCache();
    res.status(201).json(entry);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      res.status(409).json({ error: "Origin already in allowlist", code: "DUPLICATE_ORIGIN" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/:id", requirePermission("manage:users"), (req, res) => {
  try {
    corsOriginRepo.delete(getDb(), String(req.params["id"]));
    refreshCorsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
