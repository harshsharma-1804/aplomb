import { Router } from "express";
import { getDb } from "../../db/client.js";
import { scriptRepo } from "../../db/repos/scriptRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { compileTypeScript } from "../../runtime/scriptRunner.js";

const router = Router({ mergeParams: true });
const MAX_SCRIPT_BYTES = 256 * 1024;

router.get("/", (req, res) => {
  const scripts = scriptRepo.findByAppId(getDb(), (req.params as any)["appId"]);
  res.json({ count: scripts.length, results: scripts });
});

router.post("/", requirePermission("edit:endpoints"), async (req, res) => {
  const { filename, language = "javascript", source = "", description = "" } = req.body ?? {};
  if (!filename?.trim()) { res.status(400).json({ error: "filename is required", code: "VALIDATION_ERROR" }); return; }
  if (Buffer.byteLength(source) > MAX_SCRIPT_BYTES) { res.status(400).json({ error: `Script source exceeds ${MAX_SCRIPT_BYTES / 1024}KB`, code: "SCRIPT_TOO_LARGE" }); return; }

  let compiled = source;
  if (language === "typescript" && source?.trim()) {
    const { js, error } = await compileTypeScript(source);
    if (error) { res.status(400).json({ error, code: "SCRIPT_COMPILE_ERROR" }); return; }
    compiled = js;
  }

  try {
    const script = scriptRepo.create(getDb(), { app_id: (req.params as any)["appId"], filename: filename.trim(), language, source, compiled, description });
    res.status(201).json(script);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "A script with this filename already exists", code: "DUPLICATE_FILENAME" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.get("/:scriptId", (req, res) => {
  const ps = req.params as any;
  const db = getDb();
  const script = scriptRepo.findById(db, ps["scriptId"]);
  if (!script || script.app_id !== ps["appId"]) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(script);
});

router.put("/:scriptId", requirePermission("edit:endpoints"), async (req, res) => {
  const ps = req.params as any;
  const db = getDb();
  const existing = scriptRepo.findById(db, ps["scriptId"]);
  if (!existing || existing.app_id !== ps["appId"]) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

  const { filename, language, source, description } = req.body ?? {};
  if (source !== undefined && Buffer.byteLength(source) > MAX_SCRIPT_BYTES) { res.status(400).json({ error: `Script source exceeds ${MAX_SCRIPT_BYTES / 1024}KB`, code: "SCRIPT_TOO_LARGE" }); return; }

  const effectiveLanguage = language ?? existing.language;
  const effectiveSource   = source   ?? existing.source;

  let compiled = effectiveSource;
  if (effectiveLanguage === "typescript" && effectiveSource?.trim()) {
    const { js, error } = await compileTypeScript(effectiveSource);
    if (error) { res.status(400).json({ error, code: "SCRIPT_COMPILE_ERROR" }); return; }
    compiled = js;
  }

  try {
    const updated = scriptRepo.update(db, ps["scriptId"], { filename: filename?.trim(), language, source, compiled, description });
    res.json(updated);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "A script with this filename already exists", code: "DUPLICATE_FILENAME" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.delete("/:scriptId", requirePermission("edit:endpoints"), (req, res) => {
  const ps = req.params as any;
  const db = getDb();
  const script = scriptRepo.findById(db, ps["scriptId"]);
  if (!script || script.app_id !== ps["appId"]) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  scriptRepo.delete(db, ps["scriptId"]);
  res.json({ success: true });
});

export default router;
