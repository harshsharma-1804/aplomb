CREATE TABLE `app_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`filename` text NOT NULL,
	`language` text DEFAULT 'javascript' NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`compiled` text,
	`description` text DEFAULT '',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_scripts_unique` ON `app_scripts` (`app_id`,`filename`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_path` text NOT NULL,
	`description` text DEFAULT '',
	`status` text DEFAULT 'draft' NOT NULL,
	`deprecated_at` text,
	`auth_required` integer DEFAULT true NOT NULL,
	`mode` text DEFAULT 'prod' NOT NULL,
	`app_env` text DEFAULT '[]' NOT NULL,
	`allowed_provider_ids` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_base_path_unique` ON `apps` (`base_path`);--> statement-breakpoint
CREATE TABLE `endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`method` text NOT NULL,
	`path` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`script_mode` text DEFAULT 'none' NOT NULL,
	`script_file_id` text,
	`path_params` text DEFAULT '[]' NOT NULL,
	`query_params` text DEFAULT '[]' NOT NULL,
	`request` text DEFAULT '{}' NOT NULL,
	`upstream` text DEFAULT '{}' NOT NULL,
	`output_schema` text DEFAULT '[]' NOT NULL,
	`field_mappings` text DEFAULT '[]' NOT NULL,
	`sample_response` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_endpoints_app_id` ON `endpoints` (`app_id`);--> statement-breakpoint
CREATE INDEX `idx_endpoints_app_method` ON `endpoints` (`app_id`,`method`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_endpoints_unique` ON `endpoints` (`app_id`,`method`,`path`);--> statement-breakpoint
CREATE TABLE `host_allowlist` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`description` text DEFAULT '',
	`is_wildcard` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_allowlist_hostname_unique` ON `host_allowlist` (`hostname`);--> statement-breakpoint
CREATE TABLE `identity_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'oidc' NOT NULL,
	`issuer` text NOT NULL,
	`jwks_uri` text,
	`audience` text DEFAULT '[]' NOT NULL,
	`algorithms` text DEFAULT '["RS256"]' NOT NULL,
	`claim_mappings` text DEFAULT '{"subject":"sub","email":"email","roles":"groups"}' NOT NULL,
	`clock_tolerance_sec` integer DEFAULT 60 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_providers_issuer_unique` ON `identity_providers` (`issuer`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`created_by` text,
	`rotated_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_name_unique` ON `secrets` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text DEFAULT '',
	`user_agent` text DEFAULT '',
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`failed_login_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `version_history` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`change_type` text NOT NULL,
	`changed_by` text DEFAULT '{}' NOT NULL,
	`description` text DEFAULT '',
	`snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_version_history_app` ON `version_history` (`app_id`,`created_at`);