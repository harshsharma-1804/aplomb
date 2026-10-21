import { param } from "../../utils/params.js";
import { Router } from "express";
import { hash as argon2Hash } from "@node-rs/argon2";
import { getDb } from "../../db/client.js";
import { userRepo } from "../../db/repos/userRepo.js";
import { requirePermission } from "../../auth/rbac.js";
import { config } from "../../config/appConfig.js";

const router = Router();

router.get("/", requirePermission("manage:users"), (_req, res) => {
  const users = userRepo.list(getDb());
  res.json({ count: users.length, results: users });
});

router.post("/", requirePermission("manage:users"), async (req, res) => {
  const { username, email, password, role } = req.body ?? {};
  if (!username || !email || !password || password.length < config.auth.minPasswordLength) {
    res.status(400).json({ error: `username, email, and password (min ${config.auth.minPasswordLength} chars) are required`, code: "VALIDATION_ERROR" }); return;
  }
  try {
    const password_hash = await argon2Hash(password);
    const user = userRepo.create(getDb(), { username, email, password_hash, role: role ?? "viewer", must_change_password: true, created_by: req.dashboardUser?.id });
    res.status(201).json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) { res.status(409).json({ error: "Username or email already exists", code: "DUPLICATE_USER" }); return; }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

router.put("/:id/role", requirePermission("manage:users"), (req, res) => {
  if (param(req.params["id"]) === req.dashboardUser?.id) { res.status(400).json({ error: "Cannot change your own role", code: "SELF_MODIFY" }); return; }
  userRepo.updateRole(getDb(), param(param(req.params["id"])), req.body.role);
  const user = userRepo.findById(getDb(), param(param(req.params["id"])));
  if (!user) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(user);
});

router.post("/:id/reset-password", requirePermission("manage:users"), async (req, res) => {
  const { password } = req.body ?? {};
  if (!password || password.length < config.auth.minPasswordLength) {
    res.status(400).json({ error: `Password must be at least ${config.auth.minPasswordLength} characters`, code: "VALIDATION_ERROR" }); return;
  }
  const password_hash = await argon2Hash(password);
  userRepo.updatePassword(getDb(), param(param(req.params["id"])), password_hash);
  res.json({ success: true });
});

router.delete("/:id", requirePermission("manage:users"), (req, res) => {
  if (param(req.params["id"]) === req.dashboardUser?.id) { res.status(400).json({ error: "Cannot deactivate yourself", code: "SELF_DELETE" }); return; }
  userRepo.setActive(getDb(), param(param(req.params["id"])), false);
  res.json({ success: true });
});

export default router;
