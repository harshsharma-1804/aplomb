ALTER TABLE `ai_bots` ADD `allowed_app_ids` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_bots` ADD `allowed_provider_ids` text DEFAULT '[]' NOT NULL;
