CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`title` text NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`sections_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`source_url` text,
	`source_title` text,
	`source_message_count` integer,
	`favorite` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_owner_view_updated_idx` ON `notes` (`owner_key`,`deleted_at`,`archived`,`favorite`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notes_owner_source_url_unique_idx` ON `notes` (`owner_key`,`source_url`) WHERE "notes"."source_url" IS NOT NULL;