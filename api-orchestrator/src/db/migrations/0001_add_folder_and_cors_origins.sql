ALTER TABLE `endpoints` ADD `folder` text;
--> statement-breakpoint
ALTER TABLE `app_scripts` ADD `folder` text;
--> statement-breakpoint
CREATE TABLE `cors_origins` (
	`id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`description` text DEFAULT '',
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cors_origins_origin_unique` ON `cors_origins` (`origin`);
