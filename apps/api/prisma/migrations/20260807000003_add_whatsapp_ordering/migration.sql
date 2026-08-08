-- Pedido assistido por IA no WhatsApp.
--
-- O cliente do número empresarial não precisa criar login. O pedido guarda o
-- nome/telefone informado e o rascunho persistente fica ligado à conversa que
-- recebeu o webhook. As FKs compostas impedem cruzar conversa, rascunho ou
-- pedido entre empresas mesmo fora da camada de serviço.

ALTER TABLE `Order`
  DROP FOREIGN KEY `Order_customerId_fkey`;

ALTER TABLE `Order`
  MODIFY `customerId` VARCHAR(191) NULL,
  ADD COLUMN `customerName` VARCHAR(191) NULL,
  ADD COLUMN `customerPhone` VARCHAR(20) NULL,
  ADD COLUMN `source` ENUM('SITE', 'WHATSAPP') NOT NULL DEFAULT 'SITE',
  ADD COLUMN `whatsappConversationId` VARCHAR(191) NULL,
  ADD COLUMN `whatsappOrderDraftId` VARCHAR(191) NULL,
  ADD INDEX `Order_companyId_customerPhone_idx`(`companyId`, `customerPhone`),
  ADD INDEX `Order_whatsappConversationId_companyId_idx`(`whatsappConversationId`, `companyId`),
  ADD UNIQUE INDEX `Order_whatsappOrderDraftId_key`(`whatsappOrderDraftId`),
  ADD UNIQUE INDEX `Order_whatsappOrderDraftId_companyId_key`(`whatsappOrderDraftId`, `companyId`);

ALTER TABLE `Order`
  ADD CONSTRAINT `Order_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `WhatsAppConversation`
  ADD UNIQUE INDEX `WhatsAppConversation_id_companyId_key`(`id`, `companyId`);

CREATE TABLE `WhatsAppOrderDraft` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `status` ENUM('MONTANDO', 'AGUARDANDO_CONFIRMACAO', 'CONCLUIDO', 'CANCELADO') NOT NULL DEFAULT 'MONTANDO',
  `cart` JSON NULL,
  `customerName` VARCHAR(191) NULL,
  `addressStreet` VARCHAR(191) NULL,
  `addressNumber` VARCHAR(191) NULL,
  `addressComplement` VARCHAR(191) NULL,
  `addressNeighborhood` VARCHAR(191) NULL,
  `addressCity` VARCHAR(191) NULL,
  `addressState` VARCHAR(2) NULL,
  `addressZipCode` VARCHAR(8) NULL,
  `addressReference` VARCHAR(191) NULL,
  `addressLatitude` DECIMAL(10, 7) NULL,
  `addressLongitude` DECIMAL(10, 7) NULL,
  `paymentMethod` ENUM('DINHEIRO', 'CARTAO_ENTREGA', 'PIX_MANUAL') NULL,
  `notes` TEXT NULL,
  `quoteSnapshot` JSON NULL,
  `quoteFingerprint` VARCHAR(64) NULL,
  `confirmationRequestedAt` DATETIME(3) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `WhatsAppOrderDraft_conversationId_key`(`conversationId`),
  UNIQUE INDEX `WhatsAppOrderDraft_id_companyId_key`(`id`, `companyId`),
  UNIQUE INDEX `WhatsAppOrderDraft_conversationId_companyId_key`(`conversationId`, `companyId`),
  INDEX `WhatsAppOrderDraft_companyId_status_updatedAt_idx`(`companyId`, `status`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsAppOrderDraft`
  ADD CONSTRAINT `WhatsAppOrderDraft_companyId_fkey`
  FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppOrderDraft_conversationId_companyId_fkey`
  FOREIGN KEY (`conversationId`, `companyId`) REFERENCES `WhatsAppConversation`(`id`, `companyId`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Order`
  ADD CONSTRAINT `Order_whatsappConversationId_companyId_fkey`
  FOREIGN KEY (`whatsappConversationId`, `companyId`) REFERENCES `WhatsAppConversation`(`id`, `companyId`)
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `Order_whatsappOrderDraftId_companyId_fkey`
  FOREIGN KEY (`whatsappOrderDraftId`, `companyId`) REFERENCES `WhatsAppOrderDraft`(`id`, `companyId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
