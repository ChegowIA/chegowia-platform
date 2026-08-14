-- A prévia é isolada por empresa, expira em pouco tempo e não armazena o
-- arquivo enviado. Só os dados normalizados que o usuário irá revisar ficam
-- disponíveis até a confirmação explícita.

CREATE TABLE `CatalogImportSession` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `sourceFileName` VARCHAR(191) NOT NULL,
  `sourceSummary` JSON NULL,
  `normalizedProducts` JSON NOT NULL,
  `warnings` JSON NULL,
  `aiRequestId` VARCHAR(191) NULL,
  `status` ENUM('PENDENTE', 'APLICADO', 'EXPIRADO') NOT NULL DEFAULT 'PENDENTE',
  `expiresAt` DATETIME(3) NOT NULL,
  `appliedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `CatalogImportSession_companyId_createdAt_idx`(`companyId`, `createdAt`),
  INDEX `CatalogImportSession_companyId_status_expiresAt_idx`(`companyId`, `status`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CatalogImportSession`
  ADD CONSTRAINT `CatalogImportSession_companyId_fkey`
  FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
