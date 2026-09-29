-- Multiple mail senders with purpose-based routing (replaces single org_mail_config).
-- Existing single-SMTP config is migrated into a "Default" sender + org verification route.

CREATE TABLE `mail_senders` (
  `id`            text PRIMARY KEY NOT NULL,
  `name`          text NOT NULL UNIQUE,
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
--> statement-breakpoint
CREATE TABLE `mail_routes` (
  `id`         text PRIMARY KEY NOT NULL,
  `purpose`    text NOT NULL,
  `app_id`     text,
  `sender_id`  text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`sender_id`) REFERENCES `mail_senders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_routes_purpose_app_unique` ON `mail_routes` (`purpose`,`app_id`);
--> statement-breakpoint
-- Migrate the existing single config (if present) into a sender + org route.
INSERT INTO `mail_senders` (`id`, `name`, `host`, `port`, `secure`, `username`, `password_ref`, `from_address`, `from_name`, `is_active`, `updated_by`, `created_at`, `updated_at`)
SELECT 'default', 'Default', `host`, `port`, `secure`, `username`, `password_ref`, `from_address`, `from_name`, `is_active`, `updated_by`, `created_at`, `updated_at`
FROM `org_mail_config` WHERE `id` = 'default';
--> statement-breakpoint
INSERT INTO `mail_routes` (`id`, `purpose`, `app_id`, `sender_id`, `created_at`, `updated_at`)
SELECT 'verification-default', 'verification', NULL, 'default', `created_at`, `updated_at`
FROM `org_mail_config` WHERE `id` = 'default';
--> statement-breakpoint
DROP TABLE `org_mail_config`;
