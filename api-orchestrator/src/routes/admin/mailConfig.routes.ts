import { Router } from "express";
import { param } from "../../utils/params.js";
import { getDb } from "../../db/client.js";
import { mailSenderRepo, MAIL_PURPOSES } from "../../db/repos/mailSenderRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { sendMail, sendViaSender, MailNotConfiguredError } from "../../notify/mailer.js";
import { isSmsConfigured } from "../../notify/sms.js";

/**
 * Org mail management:
 *   GET/POST/PUT/DELETE  /senders[/:id]   — multiple named SMTP senders
 *   GET/PUT/DELETE       /routes          — purpose → sender routing
 *                                           (app_id null = org default; per-app rows override)
 *   POST                 /test            — test-send via a specific sender or routed one
 * SMS provider status exposed as a placeholder until a partner/BYO integration lands.
 */

const router = Router();

// ── Senders ───────────────────────────────────────────────────────────────────

router.get("/senders", requirePermission("manage:providers"), (_req, res) => {
  const senders = mailSenderRepo.listSenders();
  res.json({ count: senders.length, results: senders });
});

router.post("/senders", requirePermission("manage:providers"), (req, res) => {
  const { name, host, port, secure, username, password_ref, from_address, from_name, is_active } = req.body ?? {};
  if (!name || !host || !from_address) {
    res.status(400).json({ error: "name, host and from_address are required", code: "VALIDATION_ERROR" });
    return;
  }
  try {
    const sender = mailSenderRepo.createSender(getDb(), {
      name: String(name), host: String(host), port: Number(port ?? 587), secure: Boolean(secure),
      username: String(username ?? ""),
      password_ref: password_ref ? String(password_ref) : null,
      from_address: String(from_address), from_name: String(from_name ?? ""),
      is_active: is_active === undefined ? true : Boolean(is_active),
      updated_by: req.dashboardUser?.id ?? null,
    });
    res.status(201).json(sender);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "A sender with this name already exists", code: "DUPLICATE_SENDER" }); return; }
    res.status(500).json({ error: err.message ?? "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/senders/:id", requirePermission("manage:providers"), (req, res) => {
  const { name, host, port, secure, username, password_ref, from_address, from_name, is_active } = req.body ?? {};
  const sender = mailSenderRepo.updateSender(getDb(), param(param(req.params["id"])), {
    ...(name         !== undefined ? { name: String(name) } : {}),
    ...(host         !== undefined ? { host: String(host) } : {}),
    ...(port         !== undefined ? { port: Number(port) } : {}),
    ...(secure       !== undefined ? { secure: Boolean(secure) } : {}),
    ...(username     !== undefined ? { username: String(username) } : {}),
    // undefined = keep existing secret; null = clear
    ...(password_ref !== undefined ? { password_ref: password_ref ? String(password_ref) : null } : {}),
    ...(from_address !== undefined ? { from_address: String(from_address) } : {}),
    ...(from_name    !== undefined ? { from_name: String(from_name) } : {}),
    ...(is_active    !== undefined ? { is_active: Boolean(is_active) } : {}),
    updated_by: req.dashboardUser?.id ?? null,
  });
  if (!sender) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(sender);
});

router.delete("/senders/:id", requirePermission("manage:providers"), (req, res) => {
  const result = mailSenderRepo.deleteSender(getDb(), param(param(req.params["id"])));
  if (!result.success) { res.status(409).json({ error: result.detail, code: "SENDER_ROUTED" }); return; }
  res.json({ success: true });
});

// ── Routes (purpose → sender) ─────────────────────────────────────────────────

router.get("/routes", requirePermission("manage:providers"), (_req, res) => {
  res.json({ purposes: MAIL_PURPOSES, routes: mailSenderRepo.listRoutes() });
});

router.put("/routes", requirePermission("manage:providers"), (req, res) => {
  const { purpose, sender_id, app_id } = req.body ?? {};
  if (!purpose || !(MAIL_PURPOSES as readonly string[]).includes(purpose)) {
    res.status(400).json({ error: `purpose must be one of: ${MAIL_PURPOSES.join(", ")}`, code: "VALIDATION_ERROR" });
    return;
  }
  if (!sender_id || !mailSenderRepo.findSender(String(sender_id))) {
    res.status(400).json({ error: "Unknown sender_id", code: "VALIDATION_ERROR" });
    return;
  }
  const route = mailSenderRepo.setRoute(getDb(), String(purpose), String(sender_id), app_id ? String(app_id) : null);
  res.json(route);
});

router.delete("/routes", requirePermission("manage:providers"), (req, res) => {
  const purpose = (req.query["purpose"] as string) ?? "";
  const app_id = (req.query["app_id"] as string) ?? null;
  if (!purpose || !(MAIL_PURPOSES as readonly string[]).includes(purpose)) {
    res.status(400).json({ error: `purpose must be one of: ${MAIL_PURPOSES.join(", ")}`, code: "VALIDATION_ERROR" });
    return;
  }
  mailSenderRepo.clearRoute(getDb(), String(purpose), app_id ? String(app_id) : null);
  res.json({ success: true });
});

// ── Status + test send ────────────────────────────────────────────────────────

router.get("/status", requirePermission("manage:providers"), (_req, res) => {
  res.json({
    purposes: MAIL_PURPOSES,
    routes: mailSenderRepo.listRoutes(),
    sms_configured: isSmsConfigured(),
  });
});

router.post("/test", requirePermission("manage:providers"), async (req, res) => {
  const { to, sender_id } = req.body ?? {};
  if (!to) { res.status(400).json({ error: "to is required", code: "VALIDATION_ERROR" }); return; }
  try {
    // Explicit sender wins (direct send); else the routed verification sender.
    const result = sender_id
      ? await sendViaSender(String(sender_id), {
          to: String(to),
          subject: "Orchestrator SMTP test",
          text: "SMTP is configured correctly — this is a test email from the orchestrator.",
          html: "<p>SMTP is configured correctly — this is a test email from the orchestrator.</p>",
        })
      : await sendMail({
          purpose: "verification",
          to: String(to),
          subject: "Orchestrator SMTP test",
          text: "SMTP is configured correctly — this is a test email from the orchestrator.",
          html: "<p>SMTP is configured correctly — this is a test email from the orchestrator.</p>",
        });
    res.json({ success: true, sender: result.sender });
  } catch (e: any) {
    if (e instanceof MailNotConfiguredError) {
      res.status(503).json({ error: "No mail sender is routed for this purpose", code: "MAIL_NOT_CONFIGURED" });
      return;
    }
    res.status(502).json({ error: `SMTP test failed: ${e?.message ?? "unknown error"}`, code: "SMTP_TEST_FAILED" });
  }
});

export default router;
