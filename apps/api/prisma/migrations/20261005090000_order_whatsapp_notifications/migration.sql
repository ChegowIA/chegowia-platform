-- Consentimento por pedido. Pedidos antigos permanecem sem autorização.
ALTER TABLE `Order`
  ADD COLUMN `whatsappNotificationConsentAt` DATETIME(3) NULL;

-- Outbox transacional: cada status de cada pedido gera no máximo um aviso.
CREATE TABLE `OrderWhatsAppNotification` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `orderStatus` ENUM('RECEBIDO','CONFIRMADO','EM_PREPARO','PRONTO','SAIU_PARA_ENTREGA','ENTREGUE','CANCELADO') NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `state` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lockedUntil` DATETIME(3) NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `lastError` TEXT NULL,
  `sentAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `OrderWhatsAppNotification_orderId_orderStatus_key`(`orderId`, `orderStatus`),
  INDEX `OrderWhatsAppNotification_state_nextAttemptAt_idx`(`state`, `nextAttemptAt`),
  INDEX `OrderWhatsAppNotification_companyId_createdAt_idx`(`companyId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OrderWhatsAppNotification`
  ADD CONSTRAINT `OrderWhatsAppNotification_companyId_fkey`
  FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OrderWhatsAppNotification`
  ADD CONSTRAINT `OrderWhatsAppNotification_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
