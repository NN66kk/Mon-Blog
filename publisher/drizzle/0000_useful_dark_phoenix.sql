CREATE TABLE `connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`login` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`collection` text NOT NULL,
	`body` text NOT NULL,
	`metadata` text NOT NULL,
	`source_path` text,
	`base_sha` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_drafts_owner_updated` ON `drafts` (`owner`,`updated_at`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`draft_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`commit_sha` text,
	`url` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_publications_draft_revision` ON `publications` (`draft_id`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_publications_owner` ON `publications` (`owner`,`created_at`);