-- Two-factor auth: user-based TOTP + email OTP (Features/TwoFactorAuth-11.md)
-- twofa_status: 'off' (default) | 'enabled' (user opted in) | 'enforced' (admin required)

ALTER TABLE `app_users` ADD `twofa_status` text DEFAULT 'off' NOT NULL;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `twofa_method` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `totp_secret_ct` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `totp_secret_iv` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `totp_secret_tag` text;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `totp_last_timestep` integer;
--> statement-breakpoint
ALTER TABLE `app_users` ADD `twofa_enrolled_at` text;
--> statement-breakpoint
-- Step-up state between password and factor 2 (+ enrollment confirmations).
CREATE TABLE `login_challenges` (
  `id`           text PRIMARY KEY NOT NULL,
  `app_id`       text NOT NULL,
  `user_id`      text NOT NULL,
  `kind`         text NOT NULL,
  `method`       text,
  `pending_hash` text NOT NULL,
  `code_hash`    text,
  `expires_at`   text NOT NULL,
  `last_sent_at` text,
  `attempts`     integer DEFAULT 0 NOT NULL,
  `consumed_at`  text,
  `created_at`   text NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_login_challenges_user` ON `login_challenges` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_login_challenges_expires` ON `login_challenges` (`expires_at`);
