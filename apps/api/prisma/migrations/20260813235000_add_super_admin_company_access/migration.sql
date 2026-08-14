-- Atalhos de suporte do superadmin são efêmeros e o segredo não fica no banco:
-- apenas o hash é persistido. O mesmo registro guarda a auditoria da sessão
-- assumida depois que o link for consumido.

ALTER TABLE `RefreshToken`
  ADD COLUMN `assumedAccessId` VARCHAR(191) NULL;

CREATE INDEX `RefreshToken_assumedAccessId_idx` ON `RefreshToken`(`assumedAccessId`);

CREATE TABLE `SuperAdminCompanyAccess` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `superAdminId` VARCHAR(191) NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `linkExpiresAt` DATETIME(3) NOT NULL,
  `sessionExpiresAt` DATETIME(3) NULL,
  `consumedAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `SuperAdminCompanyAccess_tokenHash_key`(`tokenHash`),
  INDEX `SuperAdminCompanyAccess_companyId_createdAt_idx`(`companyId`, `createdAt`),
  INDEX `SuperAdminCompanyAccess_superAdminId_sessionExpiresAt_idx`(`superAdminId`, `sessionExpiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SuperAdminCompanyAccess`
  ADD CONSTRAINT `SuperAdminCompanyAccess_companyId_fkey`
  FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `SuperAdminCompanyAccess_superAdminId_fkey`
  FOREIGN KEY (`superAdminId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
