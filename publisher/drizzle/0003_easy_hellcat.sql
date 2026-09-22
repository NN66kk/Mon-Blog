ALTER TABLE `drafts` ADD `filename` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_drafts_owner_filename` ON `drafts` (`owner`,`filename`);