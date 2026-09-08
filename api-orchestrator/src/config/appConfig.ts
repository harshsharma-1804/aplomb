/**
 * Central application configuration.
 *
 * Every runtime value comes from here. Nothing is hardcoded in business logic.
 * Fields marked [KMS candidate] should be migrated to a managed KMS or
 * external secret manager (AWS Secrets Manager, HashiCorp Vault, etc.) before
 * production. The field name is preserved so the call-site code never changes.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Required environment variable "${name}" is not set`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (isNaN(n)) throw new Error(`Environment variable "${name}" must be a number, got: ${v}`);
  return n;
}

function commaSeparated(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  server: {
    port: optionalNumber("PORT", 3002),
    nodeEnv: optional("NODE_ENV", "development"),
  },

  db: {
    path: optional("DB_PATH", "./data/orchestrator.db"),
  },

  // [KMS candidate] — session signing secret
  session: {
    secret: optional("SESSION_SECRET", "orchestrator-dev-secret-change-in-prod"),
    ttlMs: optionalNumber("SESSION_TTL_MS", 8 * 60 * 60 * 1000),
  },

  // [KMS candidate] — AES-256-GCM key for secrets at rest
  // Must be exactly 32 ASCII characters. Move value to KMS before production.
  secrets: {
    encryptionKey: optional("SECRETS_ENCRYPTION_KEY", "00000000000000000000000000000000"),
    keyLengthRequired: 32,
  },

  auth: {
    // Lockout policy
    maxFailedAttempts: optionalNumber("AUTH_MAX_FAILED_ATTEMPTS", 5),
    lockoutDurationMs: optionalNumber("AUTH_LOCKOUT_DURATION_MS", 15 * 60 * 1000),

    // Minimum password length
    minPasswordLength: optionalNumber("AUTH_MIN_PASSWORD_LENGTH", 12),

    // [KMS candidate] — bootstrap admin credentials, used once on first boot only
    bootstrapAdminUsername: optional("BOOTSTRAP_ADMIN_USERNAME", "admin"),
    bootstrapAdminPassword: optional("BOOTSTRAP_ADMIN_PASSWORD", "Admin@1234567890"),
  },

  upstream: {
    // Comma-separated allowed upstream hostnames. Subdomain wildcards supported: *.example.com
    hostAllowlist: commaSeparated("UPSTREAM_HOST_ALLOWLIST", ["localhost", "mock-server", "host.docker.internal"]),

    // Block private / loopback / link-local ranges unless explicitly allowlisted
    blockPrivateRanges: optional("UPSTREAM_BLOCK_PRIVATE_RANGES", "true") !== "false",

    // Default upstream call timeout in milliseconds
    timeoutMs: optionalNumber("UPSTREAM_TIMEOUT_MS", 30000),

    // Circuit breaker config
    circuitBreakerErrorThresholdPct: optionalNumber("CIRCUIT_BREAKER_ERROR_THRESHOLD_PCT", 50),
    circuitBreakerResetTimeoutMs: optionalNumber("CIRCUIT_BREAKER_RESET_TIMEOUT_MS", 30000),
    circuitBreakerVolumeThreshold: optionalNumber("CIRCUIT_BREAKER_VOLUME_THRESHOLD", 5),

    // Max retry attempts for idempotent methods
    maxRetries: optionalNumber("UPSTREAM_MAX_RETRIES", 3),
  },

  cors: {
    // Origins allowed to access the dashboard config API and auth routes
    allowedOrigins: commaSeparated("CORS_ALLOWED_ORIGINS", ["http://localhost:5000", "http://api-config-dashboard:5000"]),
    // Origins allowed to call runtime API endpoints (your app frontends).
    // Comma-separated. Use * to allow all. Empty = fall back to allowedOrigins.
    // Managed via the dashboard Admin → Allowed Origins page (stored in DB).
    // This env var seeds the initial list on first boot.
    runtimeOrigins: commaSeparated("RUNTIME_CORS_ORIGINS", []),
  },

  dashboard: {
    // When set, the orchestrator serves the built dashboard SPA from this
    // directory (unified single-container mode). Empty = disabled (split mode).
    distPath: optional("DASHBOARD_DIST", ""),
  },

  telemetry: {
    // TTL for request_logs time-series collection in seconds (default 30 days)
    logRetentionSeconds: optionalNumber("LOG_RETENTION_SECONDS", 30 * 24 * 60 * 60),
  },

  cookies: {
    name: optional("SESSION_COOKIE_NAME", "orch_sid"),
    secure: optional("NODE_ENV", "development") === "production",
    sameSite: "strict" as const,
  },

  organization: {
    /** Default org name seeded on first boot */
    name: optional("ORG_NAME", "Default Organization"),
    /** Default org slug seeded on first boot */
    slug: optional("ORG_SLUG", "default"),
  },
} as const;
