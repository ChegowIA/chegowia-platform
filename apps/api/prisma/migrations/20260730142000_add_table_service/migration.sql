CREATE TABLE `RestaurantTable` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `seats` INTEGER NOT NULL DEFAULT 4,
  `area` VARCHAR(191) NULL,
  `status` ENUM('LIVRE', 'OCUPADA', 'RESERVADA', 'INATIVA') NOT NULL DEFAULT 'LIVRE',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `RestaurantTable_companyId_name_key`(`companyId`, `name`),
  INDEX `RestaurantTable_companyId_status_idx`(`companyId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TableSession` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `tableId` VARCHAR(191) NOT NULL,
  `status` ENUM('ABERTA', 'FECHADA', 'CANCELADA') NOT NULL DEFAULT 'ABERTA',
  `customerName` VARCHAR(191) NULL,
  `customerPhone` VARCHAR(191) NULL,
  `guestCount` INTEGER NOT NULL DEFAULT 1,
  `notes` TEXT NULL,
  `openedByUserId` VARCHAR(191) NOT NULL,
  `closedByUserId` VARCHAR(191) NULL,
  `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `TableSession_companyId_status_idx`(`companyId`, `status`),
  INDEX `TableSession_tableId_status_idx`(`tableId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DiningOrder` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `tableSessionId` VARCHAR(191) NOT NULL,
  `createdByUserId` VARCHAR(191) NOT NULL,
  `status` ENUM('RECEBIDO', 'EM_PREPARO', 'PRONTO', 'SERVIDO', 'CANCELADO') NOT NULL DEFAULT 'RECEBIDO',
  `subtotal` DECIMAL(10, 2) NOT NULL,
  `notes` TEXT NULL,
  `servedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `DiningOrder_companyId_status_idx`(`companyId`, `status`),
  INDEX `DiningOrder_tableSessionId_idx`(`tableSessionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DiningOrderItem` (
  `id` VARCHAR(191) NOT NULL,
  `diningOrderId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `productName` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unitPrice` DECIMAL(10, 2) NOT NULL,
  `notes` VARCHAR(191) NULL,
  `totalPrice` DECIMAL(10, 2) NOT NULL,
  INDEX `DiningOrderItem_diningOrderId_idx`(`diningOrderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RestaurantTable`
  ADD CONSTRAINT `RestaurantTable_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TableSession`
  ADD CONSTRAINT `TableSession_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `TableSession_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `RestaurantTable`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `TableSession_openedByUserId_fkey` FOREIGN KEY (`openedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `TableSession_closedByUserId_fkey` FOREIGN KEY (`closedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `DiningOrder`
  ADD CONSTRAINT `DiningOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `DiningOrder_tableSessionId_fkey` FOREIGN KEY (`tableSessionId`) REFERENCES `TableSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `DiningOrder_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DiningOrderItem`
  ADD CONSTRAINT `DiningOrderItem_diningOrderId_fkey` FOREIGN KEY (`diningOrderId`) REFERENCES `DiningOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `DiningOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
