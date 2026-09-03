import { Router } from "express";
import { HostAllowlist } from "../../models/HostAllowlist.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshAllowlistCache } from "../../cache/allowlistCache.js";

const router = Router();

function parseHostname(input: string): { hostname: string; is_wildcard: boolean } | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Strip protocol if accidentally included
  const stripped = trimmed.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!;

  const is_wildcard = stripped.startsWith("*.");
  const hostname = is_wildcard ? stripped : stripped;

  // Basic hostname validation
  const base = is_wildcard ? stripped.slice(2) : stripped;
  if (!/^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/.test(base)) return null;

  return { hostname, is_wildcard };
}

// ── GET /__config/admin/host-allowlist ────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    const entries = await HostAllowlist.find({ org_id: orgId }).sort({ created_at: -1 }).lean();
    res.json({ count: entries.length, results: entries });
  } catch (err) {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── POST /__config/admin/host-allowlist ───────────────────────────────────────

router.post("/", requirePermission("manage:users"), async (req, res) => {
  const { hostname: raw, description } = req.body ?? {};
  if (!raw) {
    res.status(400).json({ error: "hostname is required", code: "VALIDATION_ERROR" });
    return;
  }

  const parsed = parseHostname(raw);
  if (!parsed) {
    res.status(400).json({
      error: `"${raw}" is not a valid hostname. Use format: example.com or *.example.com`,
      code: "INVALID_HOSTNAME",
    });
    return;
  }

  try {
    const orgId = (req as any).orgId;
    const entry = await HostAllowlist.create({
      org_id: orgId,
      hostname: parsed.hostname,
      description: description ?? "",
      is_wildcard: parsed.is_wildcard,
      created_by: (req as any).dashboardUser?.id ?? null,
    });
    await refreshAllowlistCache();
    res.status(201).json(entry);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Hostname already in allowlist", code: "DUPLICATE_HOSTNAME" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── DELETE /__config/admin/host-allowlist/:id ─────────────────────────────────

router.delete("/:id", requirePermission("manage:users"), async (req, res) => {
  try {
    const orgId = (req as any).orgId;
    await HostAllowlist.findOneAndDelete({ _id: req.params["id"], org_id: orgId });
    await refreshAllowlistCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
