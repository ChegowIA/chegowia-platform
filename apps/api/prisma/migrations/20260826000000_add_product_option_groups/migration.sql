-- Grupos de opções deixam a montagem de um produto livre para qualquer tipo
-- de operação: tamanhos, sabores de pizza, ponto da carne, acompanhamentos e
-- demais escolhas passam a usar a mesma estrutura.

CREATE TABLE `ProductOptionGroup` (
  `id` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `selectionType` ENUM('SINGLE', 'MULTIPLE') NOT NULL DEFAULT 'SINGLE',
  `minSelections` INTEGER NOT NULL DEFAULT 0,
  `maxSelections` INTEGER NOT NULL DEFAULT 1,
  `pricingRule` ENUM('SUM', 'HIGHEST', 'AVERAGE') NOT NULL DEFAULT 'SUM',
  `position` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `ProductOptionGroup_productId_position_idx`(`productId`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductOption` (
  `id` VARCHAR(191) NOT NULL,
  `productOptionGroupId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `priceDelta` DECIMAL(10, 2) NOT NULL DEFAULT 0,
  `position` INTEGER NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `ProductOption_productOptionGroupId_position_idx`(`productOptionGroupId`, `position`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrderItem`
  ADD COLUMN `optionSelections` JSON NULL;

ALTER TABLE `ProductOptionGroup`
  ADD CONSTRAINT `ProductOptionGroup_productId_fkey`
  FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductOption`
  ADD CONSTRAINT `ProductOption_productOptionGroupId_fkey`
  FOREIGN KEY (`productOptionGroupId`) REFERENCES `ProductOptionGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
