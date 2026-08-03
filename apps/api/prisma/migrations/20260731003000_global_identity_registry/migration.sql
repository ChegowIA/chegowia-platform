-- Um CPF/CNPJ não pode pertencer simultaneamente a uma empresa e a um usuário.
-- A tabela central torna a regra atômica mesmo sob cadastros concorrentes.
CREATE TABLE `IdentityDocument` (
  `value` VARCHAR(191) NOT NULL,
  `ownerType` ENUM('USER','COMPANY') NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `IdentityDocument_ownerId_key`(`ownerId`),
  INDEX `IdentityDocument_ownerType_idx`(`ownerType`),
  PRIMARY KEY (`value`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `IdentityDocument` (`value`, `ownerType`, `ownerId`, `updatedAt`)
SELECT `document`, 'USER', `id`, CURRENT_TIMESTAMP(3)
FROM `User`
WHERE `document` IS NOT NULL;

INSERT INTO `IdentityDocument` (`value`, `ownerType`, `ownerId`, `updatedAt`)
SELECT `cnpj`, 'COMPANY', `id`, CURRENT_TIMESTAMP(3)
FROM `Company`
WHERE `cnpj` IS NOT NULL;
