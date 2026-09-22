CREATE TABLE `article_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`path` text NOT NULL,
	`sha` text NOT NULL,
	`title` text NOT NULL,
	`tags` text NOT NULL,
	`description` text NOT NULL,
	`published_at` text,
	`updated_at` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_article_cache_owner_path` ON `article_cache` (`owner`,`path`);--> statement-breakpoint
CREATE TABLE `article_trash` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`original_sha` text NOT NULL,
	`state` text NOT NULL,
	`publication_id` text,
	`created_at` text NOT NULL,
	`restored_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_article_trash_owner` ON `article_trash` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `draft_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`draft_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`collection` text NOT NULL,
	`body` text NOT NULL,
	`metadata` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_draft_versions_revision` ON `draft_versions` (`draft_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_draft_versions_owner` ON `draft_versions` (`owner`,`draft_id`);--> statement-breakpoint
CREATE TABLE `media_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`original_name` text,
	`archived_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_entries_owner_name` ON `media_entries` (`owner`,`name`);--> statement-breakpoint
ALTER TABLE `drafts` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `action` text DEFAULT 'publish' NOT NULL;--> statement-breakpoint
ALTER TABLE `publications` ADD `title` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `trash_id` text;