CREATE TABLE `activity_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`minutes` integer,
	`distance_meters` integer,
	`steps` integer,
	`notes` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_records_user_date_idx` ON `activity_records` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `allergens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`meta` text,
	`ip_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_user_idx` ON `audit_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket` text NOT NULL,
	`outcome` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempts_bucket_idx` ON `auth_attempts` (`bucket`,`created_at`);--> statement-breakpoint
CREATE TABLE `biometric_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`unit` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `biometric_uq` ON `biometric_records` (`user_id`,`date`,`kind`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` text DEFAULT '1' NOT NULL,
	`granted` integer NOT NULL,
	`granted_at` text,
	`revoked_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consents_user_kind_uq` ON `consents` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `data_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `data_exports_user_idx` ON `data_exports` (`user_id`,`requested_at`);--> statement-breakpoint
CREATE TABLE `entitlements` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`feature` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`limit_value` integer,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlements_uq` ON `entitlements` (`plan`,`feature`);--> statement-breakpoint
CREATE TABLE `equipment_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`implies_ids` text DEFAULT '[]' NOT NULL,
	`is_custom` integer DEFAULT false NOT NULL,
	`created_by_user_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `equipment_category_idx` ON `equipment_types` (`category`);--> statement-breakpoint
CREATE TABLE `exercise_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`requirement` text DEFAULT 'required' NOT NULL,
	`group_key` text DEFAULT 'g1' NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_equipment_uq` ON `exercise_equipment` (`exercise_id`,`equipment_type_id`,`group_key`);--> statement-breakpoint
CREATE INDEX `exercise_equipment_ex_idx` ON `exercise_equipment` (`exercise_id`);--> statement-breakpoint
CREATE INDEX `exercise_equipment_eq_idx` ON `exercise_equipment` (`equipment_type_id`);--> statement-breakpoint
CREATE TABLE `exercise_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`set_index` integer NOT NULL,
	`reps` integer,
	`weight_grams` integer,
	`duration_seconds` integer,
	`rpe` integer,
	`skipped` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_logs_uq` ON `exercise_logs` (`session_id`,`exercise_id`,`set_index`);--> statement-breakpoint
CREATE INDEX `exercise_logs_session_idx` ON `exercise_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `exercise_logs_exercise_idx` ON `exercise_logs` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercise_media` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`attribution` text,
	`license` text,
	`status` text DEFAULT 'placeholder' NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercise_media_ex_idx` ON `exercise_media` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercise_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`citation` text NOT NULL,
	`url` text,
	`kind` text DEFAULT 'internal_draft' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercise_variations` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`related_exercise_id` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_variations_uq` ON `exercise_variations` (`exercise_id`,`related_exercise_id`,`relation`);--> statement-breakpoint
CREATE INDEX `exercise_variations_ex_idx` ON `exercise_variations` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`movement_pattern` text NOT NULL,
	`category` text NOT NULL,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text DEFAULT '[]' NOT NULL,
	`experience_level` text DEFAULT 'some' NOT NULL,
	`setup` text DEFAULT '[]' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`cues` text DEFAULT '[]' NOT NULL,
	`safety` text DEFAULT '[]' NOT NULL,
	`unilateral` integer DEFAULT false NOT NULL,
	`is_timed` integer DEFAULT false NOT NULL,
	`loadable` integer DEFAULT true NOT NULL,
	`tempo_factor` real DEFAULT 1 NOT NULL,
	`teen_ok` integer DEFAULT true NOT NULL,
	`child_ok` integer DEFAULT false NOT NULL,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`source_id` text,
	`media_status` text DEFAULT 'none' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `exercise_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exercises_pattern_idx` ON `exercises` (`movement_pattern`);--> statement-breakpoint
CREATE INDEX `exercises_category_idx` ON `exercises` (`category`);--> statement-breakpoint
CREATE INDEX `exercises_review_idx` ON `exercises` (`review_status`);--> statement-breakpoint
CREATE TABLE `grocery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`ingredient_id` text,
	`custom_name` text,
	`quantity` real,
	`unit` text,
	`category` text DEFAULT 'other' NOT NULL,
	`purchased` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'generated' NOT NULL,
	`estimated_paise` integer,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `grocery_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `grocery_items_list_idx` ON `grocery_items` (`list_id`);--> statement-breakpoint
CREATE TABLE `grocery_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`meal_plan_id` text,
	`name` text NOT NULL,
	`is_recurring` integer DEFAULT false NOT NULL,
	`share_token` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `grocery_lists_user_idx` ON `grocery_lists` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `grocery_lists_share_uq` ON `grocery_lists` (`share_token`);--> statement-breakpoint
CREATE TABLE `gym_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`gym_profile_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`quantity` integer,
	`detail` text DEFAULT '{}' NOT NULL,
	`preferred` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`gym_profile_id`) REFERENCES `gym_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gym_equipment_uq` ON `gym_equipment` (`gym_profile_id`,`equipment_type_id`);--> statement-breakpoint
CREATE INDEX `gym_equipment_profile_idx` ON `gym_equipment` (`gym_profile_id`);--> statement-breakpoint
CREATE TABLE `gym_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`environment` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gym_profiles_user_idx` ON `gym_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `gym_venue_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_id` text NOT NULL,
	`equipment_type_id` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`quantity` integer,
	`submitted_by_user_id` text,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `gym_venues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_type_id`) REFERENCES `equipment_types`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gym_venue_equipment_uq` ON `gym_venue_equipment` (`venue_id`,`equipment_type_id`);--> statement-breakpoint
CREATE TABLE `gym_venues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`address_line` text DEFAULT '' NOT NULL,
	`verification_status` text DEFAULT 'unclaimed' NOT NULL,
	`verified_by_user_id` text,
	`verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `gym_venues_city_idx` ON `gym_venues` (`city`);--> statement-breakpoint
CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`default_unit` text NOT NULL,
	`allergen_ids` text DEFAULT '[]' NOT NULL,
	`is_vegetarian` integer DEFAULT true NOT NULL,
	`is_vegan` integer DEFAULT true NOT NULL,
	`contains_egg` integer DEFAULT false NOT NULL,
	`approx_price_paise_per_unit` integer,
	`price_unit` text,
	`price_source` text,
	`aliases` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingredients_category_idx` ON `ingredients` (`category`);--> statement-breakpoint
CREATE TABLE `meal_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`inputs_snapshot` text NOT NULL,
	`explanation` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plans_uq` ON `meal_plans` (`user_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`href` text,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `nutrition_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`diet` text DEFAULT 'no_preference' NOT NULL,
	`cuisines` text DEFAULT '[]' NOT NULL,
	`allergen_ids` text DEFAULT '[]' NOT NULL,
	`disliked_ingredient_ids` text DEFAULT '[]' NOT NULL,
	`cooking_skill` text DEFAULT 'beginner' NOT NULL,
	`max_prep_minutes` integer DEFAULT 45 NOT NULL,
	`weekly_budget_paise` integer,
	`household_size` integer DEFAULT 1 NOT NULL,
	`include_snacks` integer DEFAULT false NOT NULL,
	`medical_dietary_note` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pantry_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`best_before` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pantry_items_uq` ON `pantry_items` (`user_id`,`ingredient_id`,`unit`);--> statement-breakpoint
CREATE TABLE `performance_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`kind` text NOT NULL,
	`reps` integer,
	`weight_grams` integer,
	`duration_seconds` integer,
	`volume_grams` integer,
	`session_id` text,
	`achieved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `milestones_user_idx` ON `performance_milestones` (`user_id`,`achieved_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_uq` ON `performance_milestones` (`user_id`,`exercise_id`,`kind`,`session_id`);--> statement-breakpoint
CREATE TABLE `plan_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`trigger` text NOT NULL,
	`diff` text NOT NULL,
	`explanation` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`applied_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `workout_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_revisions_plan_idx` ON `plan_revisions` (`plan_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `planned_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_day_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`slot_pattern` text NOT NULL,
	`sets` integer NOT NULL,
	`reps_low` integer,
	`reps_high` integer,
	`duration_seconds` integer,
	`rest_seconds` integer NOT NULL,
	`intensity_note` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`substituted_from_exercise_id` text,
	FOREIGN KEY (`workout_day_id`) REFERENCES `workout_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`substituted_from_exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `planned_exercises_day_idx` ON `planned_exercises` (`workout_day_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `planned_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_plan_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`recipe_id` text NOT NULL,
	`servings` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`swapped_from_recipe_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`swapped_from_recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planned_meals_uq` ON `planned_meals` (`meal_plan_id`,`date`,`slot`);--> statement-breakpoint
CREATE INDEX `planned_meals_plan_idx` ON `planned_meals` (`meal_plan_id`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `progress_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`metrics` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_snapshots_uq` ON `progress_snapshots` (`user_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_ingredients_uq` ON `recipe_ingredients` (`recipe_id`,`ingredient_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredients_recipe_idx` ON `recipe_ingredients` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`citation` text NOT NULL,
	`url` text
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cuisine` text NOT NULL,
	`meal_types` text NOT NULL,
	`diet_tags` text DEFAULT '[]' NOT NULL,
	`allergen_ids` text DEFAULT '[]' NOT NULL,
	`prep_minutes` integer NOT NULL,
	`cook_minutes` integer NOT NULL,
	`servings` integer DEFAULT 2 NOT NULL,
	`steps` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`nutrition` text DEFAULT 'null',
	`nutrition_source_id` text,
	`skill_level` text DEFAULT 'beginner' NOT NULL,
	`review_status` text DEFAULT 'draft' NOT NULL,
	`source_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`nutrition_source_id`) REFERENCES `recipe_sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `recipe_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipes_cuisine_idx` ON `recipes` (`cuisine`);--> statement-breakpoint
CREATE TABLE `session_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`difficulty` text,
	`recovery` text,
	`enjoyment` integer,
	`discomfort_reported` integer DEFAULT false NOT NULL,
	`discomfort_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_feedback_uq` ON `session_feedback` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`user_agent` text,
	`ip_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `subscription_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`status` text DEFAULT 'none' NOT NULL,
	`amount_paise` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`interval` text DEFAULT 'none' NOT NULL,
	`provider` text DEFAULT 'none' NOT NULL,
	`provider_ref` text,
	`started_at` text,
	`current_period_end` text,
	`cancelled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscription_user_idx` ON `subscription_records` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `substitution_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`from_exercise_id` text NOT NULL,
	`to_exercise_id` text,
	`reason` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `substitution_events_user_idx` ON `substitution_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_preferences_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pref_hist_user_idx` ON `user_preferences_history` (`user_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`age_band` text NOT NULL,
	`language` text DEFAULT 'en-IN' NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`units` text DEFAULT 'metric' NOT NULL,
	`experience` text DEFAULT 'new' NOT NULL,
	`interests` text DEFAULT '[]' NOT NULL,
	`training_days` text DEFAULT '[]' NOT NULL,
	`session_minutes` integer DEFAULT 45 NOT NULL,
	`preferred_time` text,
	`schedule_flexibility` text DEFAULT 'some' NOT NULL,
	`environment` text DEFAULT 'home' NOT NULL,
	`activities` text DEFAULT '[]' NOT NULL,
	`limitations` text DEFAULT '[]' NOT NULL,
	`accessibility` text DEFAULT '{}' NOT NULL,
	`onboarding_step` integer DEFAULT 0 NOT NULL,
	`onboarding_completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_norm_uq` ON `users` (`email_normalized`);--> statement-breakpoint
CREATE TABLE `workout_days` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`label` text NOT NULL,
	`focus` text NOT NULL,
	`target_minutes` integer NOT NULL,
	`is_rest` integer DEFAULT false NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `workout_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_days_uq` ON `workout_days` (`plan_id`,`day_of_week`);--> statement-breakpoint
CREATE INDEX `workout_days_plan_idx` ON `workout_days` (`plan_id`);--> statement-breakpoint
CREATE TABLE `workout_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`generator_version` text NOT NULL,
	`split_kind` text NOT NULL,
	`inputs_snapshot` text NOT NULL,
	`explanation` text DEFAULT '[]' NOT NULL,
	`revision_of` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_plans_user_idx` ON `workout_plans` (`user_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`workout_day_id` text,
	`gym_profile_id` text,
	`scheduled_date` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`focus` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`source` text DEFAULT 'planned' NOT NULL,
	`planned_snapshot` text,
	`started_at` text,
	`completed_at` text,
	`duration_seconds` integer,
	`notes` text DEFAULT '' NOT NULL,
	`completion_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `workout_plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workout_day_id`) REFERENCES `workout_days`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`gym_profile_id`) REFERENCES `gym_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workout_sessions_user_date_idx` ON `workout_sessions` (`user_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `workout_sessions_status_idx` ON `workout_sessions` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `workout_sessions_completion_uq` ON `workout_sessions` (`completion_key`);