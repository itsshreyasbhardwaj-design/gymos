CREATE TABLE `checkin_schedules` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cadence` text DEFAULT 'off' NOT NULL,
	`custom_days` integer,
	`reminder_time` text,
	`last_prompted_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `communication_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`unit` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`observation` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `voice_practice_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `communication_feedback_session_idx` ON `communication_feedback` (`session_id`);--> statement-breakpoint
CREATE TABLE `communication_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `communication_goals_user_idx` ON `communication_goals` (`user_id`,`active`);--> statement-breakpoint
CREATE TABLE `grooming_appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`scheduled_at` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grooming_appointments_user_idx` ON `grooming_appointments` (`user_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `grooming_routine_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`routine_id` text NOT NULL,
	`date` text NOT NULL,
	`completed_step_ids` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`routine_id`) REFERENCES `grooming_routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grooming_logs_uq` ON `grooming_routine_logs` (`routine_id`,`date`);--> statement-breakpoint
CREATE TABLE `grooming_routine_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`label` text NOT NULL,
	`product_id` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `grooming_routines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `skincare_products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `grooming_steps_routine_idx` ON `grooming_routine_steps` (`routine_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `grooming_routines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`slot` text DEFAULT 'morning' NOT NULL,
	`days_of_week` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grooming_routines_user_idx` ON `grooming_routines` (`user_id`);--> statement-breakpoint
CREATE TABLE `hygiene_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`routine_id` text NOT NULL,
	`date` text NOT NULL,
	`completed_task_ids` text DEFAULT '[]' NOT NULL,
	`snoozed_until` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`routine_id`) REFERENCES `hygiene_routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hygiene_checkins_uq` ON `hygiene_checkins` (`routine_id`,`date`);--> statement-breakpoint
CREATE TABLE `hygiene_routines` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`cadence` text DEFAULT 'daily' NOT NULL,
	`days_of_week` text DEFAULT '[]' NOT NULL,
	`every_n_days` integer,
	`reminder_time` text,
	`active` integer DEFAULT true NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hygiene_routines_user_idx` ON `hygiene_routines` (`user_id`,`active`);--> statement-breakpoint
CREATE TABLE `hygiene_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`label` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `hygiene_routines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hygiene_tasks_routine_idx` ON `hygiene_tasks` (`routine_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `media_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`granted_by_user_id` text NOT NULL,
	`granted_to_user_id` text,
	`scope` text DEFAULT 'view' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `private_media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_grants_asset_idx` ON `media_access_grants` (`asset_id`);--> statement-breakpoint
CREATE TABLE `media_deletion_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`asset_id` text NOT NULL,
	`reason` text NOT NULL,
	`bytes_freed` integer DEFAULT 0 NOT NULL,
	`file_removed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_deletion_user_idx` ON `media_deletion_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `outfit_combinations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`item_ids` text NOT NULL,
	`occasion` text DEFAULT 'everyday' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`times_worn` integer DEFAULT 0 NOT NULL,
	`last_worn_at` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outfit_combinations_user_idx` ON `outfit_combinations` (`user_id`);--> statement-breakpoint
CREATE TABLE `outfit_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`outfit_id` text,
	`occasion` text DEFAULT 'everyday' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outfit_id`) REFERENCES `outfit_combinations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outfit_plans_uq` ON `outfit_plans` (`user_id`,`date`,`occasion`);--> statement-breakpoint
CREATE TABLE `patch_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`started_at` text NOT NULL,
	`check_at` text NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `skincare_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patch_tests_user_idx` ON `patch_tests` (`user_id`,`check_at`);--> statement-breakpoint
CREATE TABLE `personal_care_supplies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`running_low` integer DEFAULT false NOT NULL,
	`last_replaced_at` text,
	`replace_every_days` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `care_supplies_user_idx` ON `personal_care_supplies` (`user_id`,`running_low`);--> statement-breakpoint
CREATE TABLE `personal_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journal_entries_user_idx` ON `personal_journal_entries` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `personal_review_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`period_kind` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`sections` text NOT NULL,
	`user_goals` text DEFAULT '[]' NOT NULL,
	`next_actions` text DEFAULT '[]' NOT NULL,
	`generator_version` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_reports_uq` ON `personal_review_reports` (`user_id`,`period_kind`,`period_start`);--> statement-breakpoint
CREATE TABLE `photo_checkin_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`checkin_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`view` text DEFAULT 'other' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`checkin_id`) REFERENCES `photo_checkins`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `private_media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_checkin_assets_uq` ON `photo_checkin_assets` (`checkin_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `photo_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_checkins_user_idx` ON `photo_checkins` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `private_media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`iv_hex` text NOT NULL,
	`auth_tag_hex` text NOT NULL,
	`sha256` text NOT NULL,
	`original_filename` text,
	`metadata_stripped` integer DEFAULT true NOT NULL,
	`duration_seconds` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `private_media_user_idx` ON `private_media_assets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cadence` text DEFAULT 'weekly' NOT NULL,
	`included_sections` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `skincare_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`comfort` integer,
	`concerns` text DEFAULT '[]' NOT NULL,
	`product_ids_used` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skincare_journal_uq` ON `skincare_journal` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `skincare_products` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`brand` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`key_ingredients` text DEFAULT '[]' NOT NULL,
	`opened_at` text,
	`expires_at` text,
	`pao_months` integer,
	`price_paise` integer,
	`running_low` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skincare_products_user_idx` ON `skincare_products` (`user_id`,`archived`);--> statement-breakpoint
CREATE TABLE `voice_practice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`script_id` text,
	`goal_id` text,
	`date` text NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`script_word_count` integer,
	`words_per_minute` integer,
	`pause_count` integer,
	`longest_pause_ms` integer,
	`speaking_ratio` real,
	`filler_tally` integer,
	`self_rated_clarity` integer,
	`reflection` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goal_id`) REFERENCES `communication_goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `voice_sessions_user_idx` ON `voice_practice_sessions` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `voice_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `voice_practice_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `private_media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_recordings_uq` ON `voice_recordings` (`session_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `wardrobe_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`colors` text DEFAULT '[]' NOT NULL,
	`fabric` text DEFAULT '' NOT NULL,
	`size_label` text DEFAULT '' NOT NULL,
	`occasion_tags` text DEFAULT '[]' NOT NULL,
	`season_tags` text DEFAULT '[]' NOT NULL,
	`formality` integer DEFAULT 2 NOT NULL,
	`warmth` integer DEFAULT 2 NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`times_worn` integer DEFAULT 0 NOT NULL,
	`last_worn_at` text,
	`needs_care` integer DEFAULT false NOT NULL,
	`asset_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `private_media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `wardrobe_items_user_idx` ON `wardrobe_items` (`user_id`,`archived`);