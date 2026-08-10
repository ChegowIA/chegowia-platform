-- Canal institucional isolado da ChegowIA. Essas tabelas não possuem
-- companyId de propósito: elas nunca entram no Prisma tenant-scoped e não
-- compartilham conversas, mensagens ou credenciais com uma empresa cliente.

CREATE TABLE `PlatformWhatsAppChannel` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `status` ENUM('ATIVO', 'INATIVO') NOT NULL DEFAULT 'ATIVO',
  `config` JSON NOT NULL,
  `metaPhoneNumberId` VARCHAR(191) NULL,
  `metaBusinessAccountId` VARCHAR(191) NULL,
  `metaAccessTokenEncrypted` TEXT NULL,
  `metaDisplayPhoneNumber` VARCHAR(191) NULL,
  `metaVerifiedName` VARCHAR(191) NULL,
  `metaQualityRating` VARCHAR(191) NULL,
  `automationEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `welcomeMessage` TEXT NULL,
  `salesInstructions` TEXT NULL,
  `connectedAt` DATETIME(3) NULL,
  `lastWebhookAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PlatformWhatsAppChannel_key_key`(`key`),
  UNIQUE INDEX `PlatformWhatsAppChannel_metaPhoneNumberId_key`(`metaPhoneNumberId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformWhatsAppConversation` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `customerPhone` VARCHAR(191) NOT NULL,
  `customerName` VARCHAR(191) NULL,
  `mode` ENUM('VIRTUAL', 'HUMANO') NOT NULL DEFAULT 'VIRTUAL',
  `status` ENUM('ABERTA', 'ENCERRADA') NOT NULL DEFAULT 'ABERTA',
  `lastMessageText` TEXT NULL,
  `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastInboundAt` DATETIME(3) NULL,
  `humanRequestedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PlatformWhatsAppConversation_channelId_customerPhone_key`(`channelId`, `customerPhone`),
  INDEX `PlatformWhatsAppConversation_status_lastMessageAt_idx`(`status`, `lastMessageAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformWhatsAppMessage` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `direction` ENUM('RECEBIDA', 'ENVIADA') NOT NULL,
  `status` ENUM('RECEBIDA', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU') NOT NULL,
  `type` VARCHAR(191) NOT NULL DEFAULT 'text',
  `body` TEXT NULL,
  `sentByUserId` VARCHAR(191) NULL,
  `sentByName` VARCHAR(191) NULL,
  `errorCode` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `rawPayload` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PlatformWhatsAppMessage_providerMessageId_key`(`providerMessageId`),
  INDEX `PlatformWhatsAppMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
  INDEX `PlatformWhatsAppMessage_channelId_providerMessageId_idx`(`channelId`, `providerMessageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformWhatsAppConversation`
  ADD CONSTRAINT `PlatformWhatsAppConversation_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `PlatformWhatsAppChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PlatformWhatsAppMessage`
  ADD CONSTRAINT `PlatformWhatsAppMessage_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `PlatformWhatsAppChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PlatformWhatsAppMessage_conversationId_fkey`
  FOREIGN KEY (`conversationId`) REFERENCES `PlatformWhatsAppConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
