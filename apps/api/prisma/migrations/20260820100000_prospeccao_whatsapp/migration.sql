-- AlterTable
ALTER TABLE `PlatformWhatsAppChannel` ADD COLUMN `outreachTemplateBody` TEXT NULL,
    ADD COLUMN `outreachTemplateId` VARCHAR(191) NULL,
    ADD COLUMN `outreachTemplateLanguage` VARCHAR(191) NULL,
    ADD COLUMN `outreachTemplateName` VARCHAR(191) NULL,
    ADD COLUMN `outreachTemplateParams` JSON NULL;

-- CreateTable
CREATE TABLE `PlatformOutreachCampaign` (
    `id` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('RASCUNHO', 'ENVIANDO', 'PAUSADA', 'CONCLUIDA', 'CANCELADA') NOT NULL DEFAULT 'RASCUNHO',
    `fallbackName` VARCHAR(191) NOT NULL DEFAULT 'tudo bem',
    `dailyLimit` INTEGER NOT NULL DEFAULT 200,
    `minIntervalSeconds` INTEGER NOT NULL DEFAULT 15,
    `maxIntervalSeconds` INTEGER NOT NULL DEFAULT 30,
    `respectBusinessHours` BOOLEAN NOT NULL DEFAULT true,
    `nextSendAt` DATETIME(3) NULL,
    `pausedReason` TEXT NULL,
    `totalTargets` INTEGER NOT NULL DEFAULT 0,
    `sentCount` INTEGER NOT NULL DEFAULT 0,
    `repliedCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `createdByUserId` VARCHAR(191) NULL,
    `createdByName` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlatformOutreachCampaign_status_nextSendAt_idx`(`status`, `nextSendAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformOutreachTarget` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `status` ENUM('PENDENTE', 'ENVIADO', 'RESPONDEU', 'FALHOU', 'DESCARTADO') NOT NULL DEFAULT 'PENDENTE',
    `conversationId` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `sentAt` DATETIME(3) NULL,
    `repliedAt` DATETIME(3) NULL,
    `errorMessage` TEXT NULL,
    `discardReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlatformOutreachTarget_status_campaignId_idx`(`status`, `campaignId`),
    INDEX `PlatformOutreachTarget_phone_idx`(`phone`),
    UNIQUE INDEX `PlatformOutreachTarget_campaignId_phone_key`(`campaignId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformOutreachBlock` (
    `id` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `blockedByName` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PlatformOutreachBlock_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PlatformOutreachCampaign` ADD CONSTRAINT `PlatformOutreachCampaign_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `PlatformWhatsAppChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformOutreachTarget` ADD CONSTRAINT `PlatformOutreachTarget_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `PlatformOutreachCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlatformOutreachTarget` ADD CONSTRAINT `PlatformOutreachTarget_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `PlatformWhatsAppConversation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

