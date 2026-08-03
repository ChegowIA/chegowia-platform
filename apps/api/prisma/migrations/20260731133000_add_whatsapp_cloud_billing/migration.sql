-- WhatsApp Cloud API por empresa, inbox híbrido e razão de consumo variável.
-- O telefone externo é único na plataforma: o webhook resolve o tenant usando
-- `metaPhoneNumberId`, nunca um companyId enviado pelo cliente.

ALTER TABLE `AIConversation`
  MODIFY `channel` ENUM('INTERNO', 'CLIENTE', 'WHATSAPP') NOT NULL;

ALTER TABLE `MessagingChannel`
  ADD COLUMN `metaPhoneNumberId` VARCHAR(191) NULL,
  ADD COLUMN `metaBusinessAccountId` VARCHAR(191) NULL,
  ADD COLUMN `metaAccessTokenEncrypted` TEXT NULL,
  ADD COLUMN `metaDisplayPhoneNumber` VARCHAR(191) NULL,
  ADD COLUMN `metaVerifiedName` VARCHAR(191) NULL,
  ADD COLUMN `metaQualityRating` VARCHAR(191) NULL,
  ADD COLUMN `automationEnabled` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `welcomeMessage` TEXT NULL,
  ADD COLUMN `connectedAt` DATETIME(3) NULL,
  ADD COLUMN `lastWebhookAt` DATETIME(3) NULL,
  ADD COLUMN `lastError` TEXT NULL,
  ADD UNIQUE INDEX `MessagingChannel_metaPhoneNumberId_key`(`metaPhoneNumberId`);

CREATE TABLE `WhatsAppConversation` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `aiConversationId` VARCHAR(191) NULL,
  `customerPhone` VARCHAR(191) NOT NULL,
  `customerName` VARCHAR(191) NULL,
  `mode` ENUM('VIRTUAL', 'HUMANO') NOT NULL DEFAULT 'VIRTUAL',
  `status` ENUM('ABERTA', 'ENCERRADA') NOT NULL DEFAULT 'ABERTA',
  `assignedToUserId` VARCHAR(191) NULL,
  `lastMessageText` TEXT NULL,
  `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastInboundAt` DATETIME(3) NULL,
  `humanRequestedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WhatsAppConversation_aiConversationId_key`(`aiConversationId`),
  UNIQUE INDEX `WhatsAppConversation_channelId_customerPhone_key`(`channelId`, `customerPhone`),
  INDEX `WhatsAppConversation_companyId_status_lastMessageAt_idx`(`companyId`, `status`, `lastMessageAt`),
  INDEX `WhatsAppConversation_assignedToUserId_idx`(`assignedToUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WhatsAppMessage` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `direction` ENUM('RECEBIDA', 'ENVIADA') NOT NULL,
  `status` ENUM('RECEBIDA', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU') NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'text',
  `body` TEXT NULL,
  `pricingCategory` VARCHAR(191) NULL,
  `providerCost` DECIMAL(16, 6) NOT NULL DEFAULT 0,
  `billableAmount` DECIMAL(16, 6) NOT NULL DEFAULT 0,
  `sentByUserId` VARCHAR(191) NULL,
  `errorCode` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `rawPayload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WhatsAppMessage_providerMessageId_key`(`providerMessageId`),
  INDEX `WhatsAppMessage_companyId_createdAt_idx`(`companyId`, `createdAt`),
  INDEX `WhatsAppMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
  INDEX `WhatsAppMessage_channelId_providerMessageId_idx`(`channelId`, `providerMessageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UsageRate` (
  `id` VARCHAR(191) NOT NULL,
  `metric` ENUM('IA_TOKENS_ENTRADA', 'IA_TOKENS_SAIDA', 'WHATSAPP_SERVICO', 'WHATSAPP_TEMPLATE_UTILIDADE', 'WHATSAPP_TEMPLATE_MARKETING', 'WHATSAPP_TEMPLATE_AUTENTICACAO') NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `unitSize` DECIMAL(16, 6) NOT NULL DEFAULT 1,
  `providerUnitCost` DECIMAL(16, 6) NOT NULL DEFAULT 0,
  `markupPercent` DECIMAL(8, 4) NOT NULL DEFAULT 0,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UsageRate_metric_key`(`metric`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `UsageLedger` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NULL,
  `usageRateId` VARCHAR(191) NULL,
  `source` ENUM('IA', 'WHATSAPP') NOT NULL,
  `metric` ENUM('IA_TOKENS_ENTRADA', 'IA_TOKENS_SAIDA', 'WHATSAPP_SERVICO', 'WHATSAPP_TEMPLATE_UTILIDADE', 'WHATSAPP_TEMPLATE_MARKETING', 'WHATSAPP_TEMPLATE_AUTENTICACAO') NOT NULL,
  `quantity` DECIMAL(18, 6) NOT NULL,
  `providerAmount` DECIMAL(16, 6) NOT NULL DEFAULT 0,
  `billableAmount` DECIMAL(16, 6) NOT NULL DEFAULT 0,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'brl',
  `externalReference` VARCHAR(191) NULL,
  `status` ENUM('PENDENTE', 'SINCRONIZADO', 'FATURADO', 'FALHOU') NOT NULL DEFAULT 'PENDENTE',
  `stripeInvoiceItemId` VARCHAR(191) NULL,
  `stripeInvoiceId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `UsageLedger_externalReference_key`(`externalReference`),
  INDEX `UsageLedger_stripeInvoiceItemId_idx`(`stripeInvoiceItemId`),
  INDEX `UsageLedger_companyId_createdAt_idx`(`companyId`, `createdAt`),
  INDEX `UsageLedger_companyId_status_idx`(`companyId`, `status`),
  INDEX `UsageLedger_stripeInvoiceId_idx`(`stripeInvoiceId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WhatsAppConversation`
  ADD CONSTRAINT `WhatsAppConversation_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppConversation_channelId_fkey`
    FOREIGN KEY (`channelId`) REFERENCES `MessagingChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppConversation_aiConversationId_fkey`
    FOREIGN KEY (`aiConversationId`) REFERENCES `AIConversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppConversation_assignedToUserId_fkey`
    FOREIGN KEY (`assignedToUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WhatsAppMessage`
  ADD CONSTRAINT `WhatsAppMessage_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppMessage_channelId_fkey`
    FOREIGN KEY (`channelId`) REFERENCES `MessagingChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppMessage_conversationId_fkey`
    FOREIGN KEY (`conversationId`) REFERENCES `WhatsAppConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WhatsAppMessage_sentByUserId_fkey`
    FOREIGN KEY (`sentByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `UsageLedger`
  ADD CONSTRAINT `UsageLedger_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `UsageLedger_channelId_fkey`
    FOREIGN KEY (`channelId`) REFERENCES `MessagingChannel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `UsageLedger_usageRateId_fkey`
    FOREIGN KEY (`usageRateId`) REFERENCES `UsageRate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
