CREATE TABLE `user_ingredient_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`price_paise` integer NOT NULL,
	`per_quantity` real NOT NULL,
	`unit` text NOT NULL,
	`recorded_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_ingredient_prices_uq` ON `user_ingredient_prices` (`user_id`,`ingredient_id`,`unit`);