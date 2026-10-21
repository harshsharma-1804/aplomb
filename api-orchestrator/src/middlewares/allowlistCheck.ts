import type { Request, Response, NextFunction } from "express";
import { config } from "../config/appConfig.js";

const PRIVATE_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
];

/**
 * Returns true if the hostname resolves to a private/loopback/link-local range.
 */
export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(hostname));
}

/**
 * Returns true when the URL's hostname is in UPSTREAM_HOST_ALLOWLIST.
 * Supports exact matches and subdomain wildcards (*.example.com).
 * Private ranges are blocked unless explicitly allowlisted.
 */
export function isUpstreamAllowed(url: string): boolean {
  const allowlist = config.upstream.hostAllowlist;
  if (allowlist.length === 0) return true;

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  const matchesAllowlist = allowlist.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const domain = allowed.slice(2);
      return hostname === domain || hostname.endsWith("." + domain);
    }
    return hostname === allowed;
  });

  if (!matchesAllowlist) return false;

  if (config.upstream.blockPrivateRanges && isPrivateHost(hostname)) {
    return allowlist.includes(hostname);
  }

  return true;
}

const ALLOWED_MONGO_OPS = [
  "find", "findOne", "insertOne", "updateOne", "updateMany",
  "deleteOne", "deleteMany", "aggregate", "count",
];

/**
 * Express middleware — reads upstream URL from req.body.upstream?.url
 * or req.body.url and rejects 400 if the host is not allowlisted.
 * Also checks db_url for database upstream types and validates MongoDB operations.
 * Attach to any route that accepts an upstream URL in its body.
 */
export function upstreamAllowlistGuard(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const upstreamType: string | undefined = req.body?.upstream?.upstream_type;

  // ── HTTP / GraphQL upstream URL ────────────────────────────────────────────
  const url: string | undefined = req.body?.upstream?.url ?? req.body?.url;
  if (url && !url.includes("{{")) {
    if (!isUpstreamAllowed(url)) {
      res.status(400).json({
        error: "Upstream host is not in your organization's allowlist. Add it under Tenant Settings → Host Allowlist.",
        code: "HOST_NOT_ALLOWED",
      });
      return;
    }
  }

  // ── DB upstream URL (mongodb / postgresql / mysql) ─────────────────────────
  const dbUrl: string | undefined = req.body?.upstream?.db_url;
  if (
    dbUrl && !dbUrl.includes("{{") &&
    (upstreamType === "mongodb" || upstreamType === "postgresql" || upstreamType === "mysql")
  ) {
    if (!isUpstreamAllowed(dbUrl)) {
      res.status(400).json({
        error: "DB upstream host is not in your organization's allowlist. Add it under Tenant Settings → Host Allowlist.",
        code: "HOST_NOT_ALLOWED",
      });
      return;
    }
  }

  // ── MongoDB: validate operation + block $where at save time ───────────────
  if (upstreamType === "mongodb") {
    const op: string | undefined = req.body?.upstream?.db_operation;
    if (op && !ALLOWED_MONGO_OPS.includes(op)) {
      res.status(400).json({
        error: `MongoDB operation "${op}" is not allowed. Allowed: ${ALLOWED_MONGO_OPS.join(", ")}`,
        code: "DB_OPERATION_NOT_ALLOWED",
      });
      return;
    }
    const tmpl: string | undefined = req.body?.upstream?.db_query_template;
    if (tmpl?.includes("$where")) {
      res.status(400).json({
        error: "$where is not allowed in MongoDB query templates",
        code: "DB_OPERATION_NOT_ALLOWED",
      });
      return;
    }
  }

  next();
}
