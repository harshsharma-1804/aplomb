import { param } from "../../utils/params.js";
import { Router } from "express";
import { getDb } from "../../db/client.js";
import { hostAllowlistRepo } from "../../db/repos/hostAllowlistRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { refreshAllowlistCache } from "../../cache/allowlistCache.js";

const router = Router();

function parseHostname(input: string): { hostname: string; is_wildcard: boolean } | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^https?:\/\//, "").split("/")[0]!.split(":")[0]!;
  const is_wildcard = stripped.startsWith("*.");
  const base = is_wildcard ? stripped.slice(2) : stripped;
  if (!/^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$/.test(base)) return null;
  return { hostname: stripped, is_wildcard };
}

router.get("/", (_req, res) => {
  const entries = hostAllowlistRepo.list(getDb());
  res.json({ count: entries.length, results: entries });
});

router.post("/", requirePermission("manage:users"), (req, res) => {
  const { hostname: raw, description } = req.body ?? {};
  if (!raw) { res.status(400).json({ error: "hostname is required", code: "VALIDATION_ERROR" }); return; }
  const parsed = parseHostname(raw);
  if (!parsed) { res.status(400).json({ error: `"${raw}" is not a valid hostname`, code: "INVALID_HOSTNAME" }); return; }
  try {
    const entry = hostAllowlistRepo.create(getDb(), { ...parsed, description: description ?? "", created_by: req.dashboardUser?.id });
    refreshAllowlistCache();
    res.status(201).json(entry);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Hostname already in allowlist", code: "DUPLICATE_HOSTNAME" }); return; }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/:id", requirePermission("manage:users"), (req, res) => {
  hostAllowlistRepo.delete(getDb(), param(param(req.params["id"])));
  refreshAllowlistCache();
  res.json({ success: true });
});

export default router;
