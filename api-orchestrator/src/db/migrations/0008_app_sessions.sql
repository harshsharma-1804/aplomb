CREATE TABLE `app_sessions` (
  `id`                  text PRIMARY KEY NOT NULL,
  `app_id`              text NOT NULL,
  `sub`                 text NOT NULL,
  `email`               text,
  `issuer`              text NOT NULL,
  `device_label`        text NOT NULL,
  `ua_hash`             text NOT NULL,
  `last_seen_ip`        text,
  `idp_token_ct`        text,
  `idp_token_iv`        text,
  `idp_token_tag`       text,
  `bot_snapshot`        text DEFAULT '[]' NOT NULL,
  `idle_expires_at`     text NOT NULL,
  `absolute_expires_at` text NOT NULL,
  `last_active_at`      text NOT NULL,
  `revoked_at`          text,
  `created_at`          text NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_app_sub` ON `app_sessions` (`app_id`,`sub`);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_idle_expires` ON `app_sessions` (`idle_expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_app_sessions_absolute_expires` ON `app_sessions` (`absolute_expires_at`);
