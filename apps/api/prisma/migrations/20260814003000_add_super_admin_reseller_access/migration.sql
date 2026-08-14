-- Suporte auditável à visão de revendedor. O token cru nunca é persistido;
-- `tokenHash` recebe apenas SHA-256 do segredo que viaja no fragmento da URL.

ALTER TABLE `RefreshToken`
  ADD COLUMN `assumedAccessKind` VARCHAR(20) NULL,
  ADD COLUMN `assumedUserId` VARCHAR(191) NULL,
  ADD COLUMN `assumedResellerId` VARCHAR(191) NULL;

CREATE INDEX `RefreshToken_assumedResellerId_idx` ON `RefreshToken`(`assumedResellerId`);

CREATE TABLE `SuperAdminResellerAccess` (
  `id` VARCHAR(191) NOT NULL,
  `resellerId` VARCHAR(191) NOT NULL,
  `superAdminId` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `linkExpiresAt` DATETIME(3) NOT NULL,
  `sessionExpiresAt` DATETIME(3) NULL,
  `consumedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SuperAdminResellerAccess_tokenHash_key`(`tokenHash`),
  INDEX `SuperAdminResellerAccess_resellerId_createdAt_idx`(`resellerId`, `createdAt`),
  INDEX `SuperAdminResellerAccess_superAdminId_sessionExpiresAt_idx`(`superAdminId`, `sessionExpiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SuperAdminResellerAccess`
  ADD CONSTRAINT `SuperAdminResellerAccess_resellerId_fkey`
  FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SuperAdminResellerAccess_superAdminId_fkey`
  FOREIGN KEY (`superAdminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
