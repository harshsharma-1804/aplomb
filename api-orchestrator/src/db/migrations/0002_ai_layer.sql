ALTER TABLE `apps` ADD `ai_expose` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_bots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_key_hash` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_used_at` text,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`bot_id` text,
	`bot_name` text DEFAULT '',
	`user_id` text DEFAULT '',
	`tool_name` text NOT NULL,
	`tool_args` text DEFAULT '{}' NOT NULL,
	`outcome` text NOT NULL,
	`detail` text DEFAULT '',
	`latency_ms` integer DEFAULT 0,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_tool_calls_created` ON `ai_tool_calls` (`created_at`);
