import { Router } from "express";
import { AppScript } from "../../models/AppScript.js";
import { param } from "../../utils/params.js";
import { requirePermission } from "../../auth/rbac.js";
import { compileTypeScript } from "../../runtime/scriptRunner.js";

const router = Router({ mergeParams: true });

const MAX_SCRIPT_BYTES = 256 * 1024;

// ── GET /apps/:appId/scripts ──────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const ps = req.params as Record<string, string>;
  const scripts = await AppScript.find({ app_id: param(ps["appId"]) })
    .select("-compiled")
    .lean();
  res.json({ count: scripts.length, results: scripts });
});

// ── POST /apps/:appId/scripts ─────────────────────────────────────────────────

router.post("/", requirePermission("edit:endpoints"), async (req, res) => {
  try {
    const { filename, language = "javascript", source = "", description = "" } = req.body as {
      filename: string;
      language: string;
      source: string;
      description: string;
    };

    if (!filename?.trim()) {
      res.status(400).json({ error: "filename is required", code: "VALIDATION_ERROR" }); return;
    }

    if (Buffer.byteLength(source ?? "") > MAX_SCRIPT_BYTES) {
      res.status(400).json({ error: `Script source exceeds maximum size of ${MAX_SCRIPT_BYTES / 1024}KB`, code: "SCRIPT_TOO_LARGE" }); return;
    }

    let compiled = source;
    if (language === "typescript" && source?.trim()) {
      const { js, error } = await compileTypeScript(source);
      if (error) { res.status(400).json({ error, code: "SCRIPT_COMPILE_ERROR" }); return; }
      compiled = js;
    }

    const ps1 = req.params as Record<string, string>;
    const script = await AppScript.create({
      app_id: param(ps1["appId"]),
      filename: filename.trim(),
      language,
      source,
      compiled,
      description,
    });

    res.status(201).json(script);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "A script with this filename already exists in this app", code: "DUPLICATE_FILENAME" }); return;
    }
    console.error("[scripts POST]", err);
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── GET /apps/:appId/scripts/:scriptId ────────────────────────────────────────

router.get("/:scriptId", async (req, res) => {
  const ps = req.params as Record<string, string>;
  const script = await AppScript.findOne({
    _id: param(ps["scriptId"]),
    app_id: param(ps["appId"]),
  }).lean();
  if (!script) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(script);
});

// ── PUT /apps/:appId/scripts/:scriptId ────────────────────────────────────────

router.put("/:scriptId", requirePermission("edit:endpoints"), async (req, res) => {
  try {
    const { filename, language, source, description } = req.body as {
      filename?: string;
      language?: string;
      source?: string;
      description?: string;
    };

    if (source !== undefined && Buffer.byteLength(source) > MAX_SCRIPT_BYTES) {
      res.status(400).json({ error: `Script source exceeds maximum size of ${MAX_SCRIPT_BYTES / 1024}KB`, code: "SCRIPT_TOO_LARGE" }); return;
    }

    const ps2 = req.params as Record<string, string>;
    const existing = await AppScript.findOne({
      _id: param(ps2["scriptId"]),
      app_id: param(ps2["appId"]),
    });
    if (!existing) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }

    const effectiveLanguage = language ?? existing.language;
    const effectiveSource = source ?? existing.source;

    let compiled = effectiveSource;
    if (effectiveLanguage === "typescript" && effectiveSource?.trim()) {
      const { js, error } = await compileTypeScript(effectiveSource);
      if (error) { res.status(400).json({ error, code: "SCRIPT_COMPILE_ERROR" }); return; }
      compiled = js;
    }

    const updates: Record<string, unknown> = { compiled };
    if (filename !== undefined) updates["filename"] = filename.trim();
    if (language !== undefined) updates["language"] = language;
    if (source !== undefined) updates["source"] = source;
    if (description !== undefined) updates["description"] = description;

    const updated = await AppScript.findByIdAndUpdate(
      param(ps2["scriptId"]),
      { $set: updates },
      { new: true, runValidators: false }
    ).lean();

    res.json(updated);
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "A script with this filename already exists in this app", code: "DUPLICATE_FILENAME" }); return;
    }
    console.error("[scripts PUT]", err);
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── DELETE /apps/:appId/scripts/:scriptId ─────────────────────────────────────

router.delete("/:scriptId", requirePermission("edit:endpoints"), async (req, res) => {
  try {
    const ps3 = req.params as Record<string, string>;
    const script = await AppScript.findOneAndDelete({
      _id: param(ps3["scriptId"]),
      app_id: param(ps3["appId"]),
    });
    if (!script) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
    res.json({ success: true });
  } catch (err: any) {
    console.error("[scripts DELETE]", err);
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

export default router;
