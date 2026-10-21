-- Identity-provider login (feat/identity-provider-login)
-- See Execution Plan/Orchestrator/specs/IdentityProviderLoginSpecs-3.md

ALTER TABLE `identity_providers` ADD `client_id` text;
--> statement-breakpoint
ALTER TABLE `identity_providers` ADD `client_secret_ref` text;
--> statement-breakpoint
ALTER TABLE `identity_providers` ADD `scopes` text DEFAULT 'openid email profile' NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `auth_method` text DEFAULT 'gateway' NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `identity_provider_id` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `idp_sub` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `email_verified_at` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `phone_verified_at` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `email_verification_token_hash` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `verification_token_expires_at` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `last_login_at` text;
--> statement-breakpoint
-- SQLite unique indexes treat NULLs as distinct — gateway users (NULL provider) unaffected.
CREATE UNIQUE INDEX `app_users_app_idp_sub_unique` ON `app_users` (`app_id`,`identity_provider_id`,`idp_sub`);
--> statement-breakpoint
-- SMTP mailer settings for transactional email (verification links).
-- Single org per instance — one config row. Password lives in the Secrets vault.
CREATE TABLE `org_mail_config` (
  `id`            text PRIMARY KEY NOT NULL,
  `host`          text NOT NULL,
  `port`          integer DEFAULT 587 NOT NULL,
  `secure`        integer DEFAULT false NOT NULL,
  `username`      text DEFAULT '' NOT NULL,
  `password_ref`  text,
  `from_address`  text NOT NULL,
  `from_name`     text DEFAULT '' NOT NULL,
  `is_active`     integer DEFAULT true NOT NULL,
  `updated_by`    text,
  `created_at`    text NOT NULL,
  `updated_at`    text NOT NULL
);
