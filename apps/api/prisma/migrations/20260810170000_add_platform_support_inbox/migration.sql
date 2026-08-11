-- Suporte autenticado da plataforma, isolado dos tenants. Uma conversa é
-- sempre aberta pelo usuário real e a chave ativa impede duas filas para a
-- mesma pessoa sem depender do navegador.

CREATE TABLE `PlatformSupportConversation` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `activeKey` VARCHAR(191) NULL,
  `userName` VARCHAR(191) NOT NULL,
  `userEmail` VARCHAR(191) NOT NULL,
  `userRole` ENUM('SUPER_ADMIN', 'ADMIN', 'FUNCIONARIO', 'COZINHA', 'MOTOBOY', 'GARCOM', 'CLIENTE', 'REVENDEDOR') NOT NULL,
  `companyIdSnapshot` VARCHAR(191) NULL,
  `companyNameSnapshot` VARCHAR(191) NULL,
  `mode` ENUM('IA', 'HUMANO') NOT NULL DEFAULT 'IA',
  `status` ENUM('ABERTA', 'ENCERRADA') NOT NULL DEFAULT 'ABERTA',
  `lastMessageText` TEXT NULL,
  `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `humanRequestedAt` DATETIME(3) NULL,
  `humanHandoffNotifiedAt` DATETIME(3) NULL,
  `assignedSuperAdminId` VARCHAR(191) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PlatformSupportConversation_activeKey_key`(`activeKey`),
  INDEX `PlatformSupportConversation_userId_lastMessageAt_idx`(`userId`, `lastMessageAt`),
  INDEX `PlatformSupportConversation_status_mode_lastMessageAt_idx`(`status`, `mode`, `lastMessageAt`),
  INDEX `PlatformSupportConversation_assigned_status_last_at_idx`(`assignedSuperAdminId`, `status`, `lastMessageAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformSupportMessage` (
  `id` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `authorUserId` VARCHAR(191) NULL,
  `role` ENUM('USUARIO', 'ASSISTENTE', 'SUPER_ADMIN', 'SISTEMA') NOT NULL,
  `content` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `PlatformSupportMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformSupportConversation`
  ADD CONSTRAINT `PlatformSupportConversation_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PlatformSupportConversation_assignedSuperAdminId_fkey`
  FOREIGN KEY (`assignedSuperAdminId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PlatformSupportMessage`
  ADD CONSTRAINT `PlatformSupportMessage_conversationId_fkey`
  FOREIGN KEY (`conversationId`) REFERENCES `PlatformSupportConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PlatformSupportMessage_authorUserId_fkey`
  FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- A IA do suporte é um custo institucional, sem channelId de WhatsApp e sem
-- companyId. Tornamos o vínculo já existente opcional e adicionamos a origem
-- de suporte para manter o histórico financeiro auditável.
ALTER TABLE `PlatformUsageLedger`
  DROP FOREIGN KEY `PlatformUsageLedger_channelId_fkey`;

ALTER TABLE `PlatformUsageLedger`
  MODIFY `channelId` VARCHAR(191) NULL,
  ADD COLUMN `supportConversationId` VARCHAR(191) NULL;

CREATE INDEX `PlatformUsageLedger_supportConversationId_createdAt_idx`
  ON `PlatformUsageLedger`(`supportConversationId`, `createdAt`);

ALTER TABLE `PlatformUsageLedger`
  ADD CONSTRAINT `PlatformUsageLedger_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `PlatformWhatsAppChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PlatformUsageLedger_supportConversationId_fkey`
  FOREIGN KEY (`supportConversationId`) REFERENCES `PlatformSupportConversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
