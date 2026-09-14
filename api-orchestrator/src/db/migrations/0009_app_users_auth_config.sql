CREATE TABLE `app_users` (
  `id`             text PRIMARY KEY NOT NULL,
  `app_id`         text NOT NULL,
  `username`       text NOT NULL,
  `email`          text NOT NULL,
  `password_hash`  text NOT NULL,
  `sub`            text NOT NULL,
  `display_name`   text,
  `is_active`      integer DEFAULT 1 NOT NULL,
  `created_at`     text NOT NULL,
  `updated_at`     text NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_app_username_unique` ON `app_users` (`app_id`,`username`);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_app_email_unique` ON `app_users` (`app_id`,`email`);
--> statement-breakpoint
ALTER TABLE `apps` ADD `auth_mode` text DEFAULT 'bearer' NOT NULL;
--> statement-breakpoint
ALTER TABLE `apps` ADD `session_method` text DEFAULT 'both' NOT NULL;
--> statement-breakpoint
ALTER TABLE `apps` ADD `session_config` text DEFAULT '{}' NOT NULL;
