-- Username-level lockout: brute-force protection independent of source IP.
-- Counts consecutive failures against an account; locks it for a configurable
-- duration once the threshold is reached. Thresholds are per-app in session_config.

ALTER TABLE `app_users` ADD `failed_login_attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `locked_until` text;
