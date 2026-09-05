import { Router } from "express";
import { CorsOrigin } from "../../models/CorsOrigin.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshCorsCache } from "../../cache/corsCache.js";

const router = Router();

function parseOrigin(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "*") return "*";
  try {
    const u = new URL(trimmed);
    // Only scheme + host + optional port — no path
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// ── GET /admin/cors-origins ───────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const entries = await CorsOrigin.find({ org_id: orgId }).sort({ created_at: -1 }).lean();
    res.json({ count: entries.length, results: entries });
  } catch {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── POST /admin/cors-origins ──────────────────────────────────────────────────

router.post("/", requirePermission("manage:users"), async (req, res) => {
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
    const orgId = (req as any).orgId;
    const entry = await CorsOrigin.create({
      org_id: orgId,
      origin: parsed,
      description: description ?? "",
      created_by: (req as any).dashboardUser?.id ?? null,
    });
    await refreshCorsCache();
    res.status(201).json(entry);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Origin already in allowlist", code: "DUPLICATE_ORIGIN" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── DELETE /admin/cors-origins/:id ───────────────────────────────────────────

router.delete("/:id", requirePermission("manage:users"), async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await CorsOrigin.findOneAndDelete({ _id: req.params["id"], org_id: orgId });
    await refreshCorsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
