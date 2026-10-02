CREATE TABLE `mcp_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`name` text NOT NULL,
	`owner` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_keys_hash` ON `mcp_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_mcp_keys_owner_created` ON `mcp_keys` (`owner`,`created_at`);