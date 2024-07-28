CREATE TABLE `builds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`buildId` text NOT NULL,
	`imageName` text NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `gameServerInstances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`serverId` text NOT NULL,
	`buildId` text NOT NULL,
	`port` text NOT NULL,
	`sessionConfig` text NOT NULL,
	`status` text NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`buildId`) REFERENCES `builds`(`buildId`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `builds_buildId_unique` ON `builds` (`buildId`);--> statement-breakpoint
CREATE INDEX `serverIdIndex` ON `gameServerInstances` (`serverId`);--> statement-breakpoint
CREATE INDEX `statusIndex` ON `gameServerInstances` (`status`);