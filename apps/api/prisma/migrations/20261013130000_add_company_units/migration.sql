ALTER TABLE `Company`
  ADD COLUMN `ownerUserId` VARCHAR(191) NULL,
  ADD COLUMN `isPublished` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `demoRootCompanyId` VARCHAR(191) NULL;
CREATE INDEX `Company_ownerUserId_idx` ON `Company`(`ownerUserId`);
CREATE INDEX `Company_demoRootCompanyId_idx` ON `Company`(`demoRootCompanyId`);
DROP INDEX `Company_cnpj_key` ON `Company`;
CREATE INDEX `Company_cnpj_idx` ON `Company`(`cnpj`);
ALTER TABLE `Company` ADD CONSTRAINT `Company_ownerUserId_fkey`
  FOREIGN KEY (`ownerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RefreshToken` ADD COLUMN `activeCompanyId` VARCHAR(191) NULL;
