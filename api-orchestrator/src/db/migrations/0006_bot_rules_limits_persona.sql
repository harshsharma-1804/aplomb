ALTER TABLE `ai_bots` ADD `rules` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_bots` ADD `limits` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_bots` ADD `persona` text DEFAULT '' NOT NULL;
