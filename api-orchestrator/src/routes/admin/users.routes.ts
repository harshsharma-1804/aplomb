import { Router } from "express";
import { hash as argon2Hash } from "@node-rs/argon2";
import { User } from "../../models/User.js";
import { requirePermission } from "../../auth/rbac.js";
import { config } from "../../config/appConfig.js";

const router = Router();

// ── GET /admin/users ───────────────────────────────────────────────────────────

router.get("/", requirePermission("manage:users"), async (_req, res) => {
  const users = await User.find().select("-password_hash").lean();
  res.json({ count: users.length, results: users });
});

// ── POST /admin/users ──────────────────────────────────────────────────────────

router.post("/", requirePermission("manage:users"), async (req, res) => {
  const { username, email, password, role } = req.body ?? {};

  if (!username || !email || !password || password.length < config.auth.minPasswordLength) {
    res.status(400).json({
      error: `username, email, and password (min ${config.auth.minPasswordLength} chars) are required`,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  try {
    const password_hash = await argon2Hash(password);
    const user = await User.create({
      username,
      email,
      password_hash,
      role: role ?? "viewer",
      must_change_password: true,
      created_by: req.dashboardUser?.id,
    });
    res.status(201).json({ id: user._id, username: user.username, email: user.email, role: user.role });
  } catch (err: any) {
    if (err.code === 11000) {
      res.status(409).json({ error: "Username or email already exists", code: "DUPLICATE_USER" });
      return;
    }
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

// ── PUT /admin/users/:id/role ──────────────────────────────────────────────────

router.put("/:id/role", requirePermission("manage:users"), async (req, res) => {
  if (req.params["id"] === req.dashboardUser?.id) {
    res.status(400).json({ error: "Cannot change your own role", code: "SELF_MODIFY" });
    return;
  }
  const user = await User.findByIdAndUpdate(
    req.params["id"],
    { role: req.body.role },
    { new: true }
  ).select("-password_hash").lean();
  if (!user) { res.status(404).json({ error: "Not found", code: "NOT_FOUND" }); return; }
  res.json(user);
});

// ── POST /admin/users/:id/reset-password ──────────────────────────────────────

router.post("/:id/reset-password", requirePermission("manage:users"), async (req, res) => {
  const { password } = req.body ?? {};
  if (!password || password.length < config.auth.minPasswordLength) {
    res.status(400).json({
      error: `Password must be at least ${config.auth.minPasswordLength} characters`,
      code: "VALIDATION_ERROR",
    });
    return;
  }
  const password_hash = await argon2Hash(password);
  await User.findByIdAndUpdate(req.params["id"], { password_hash, must_change_password: true });
  res.json({ success: true });
});

// ── DELETE /admin/users/:id ────────────────────────────────────────────────────

router.delete("/:id", requirePermission("manage:users"), async (req, res) => {
  if (req.params["id"] === req.dashboardUser?.id) {
    res.status(400).json({ error: "Cannot deactivate yourself", code: "SELF_DELETE" });
    return;
  }
  await User.findByIdAndUpdate(req.params["id"], { is_active: false });
  res.json({ success: true });
});

export default router;
