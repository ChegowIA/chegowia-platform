ALTER TABLE `MessagingChannel` MODIFY COLUMN `provider` ENUM('GUPSHUP', 'META_CLOUD', 'BAILEYS') NOT NULL DEFAULT 'GUPSHUP';
ALTER TABLE `PlatformWhatsAppChannel` MODIFY COLUMN `provider` ENUM('GUPSHUP', 'META_CLOUD', 'BAILEYS') NOT NULL DEFAULT 'GUPSHUP';

ALTER TABLE `PlatformOutreachCampaign`
  ADD COLUMN `sourceType` VARCHAR(191) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN `importFileHash` VARCHAR(191) NULL,
  ADD COLUMN `importSheet` VARCHAR(191) NULL,
  ADD COLUMN `importMapping` JSON NULL,
  ADD COLUMN `promptVersion` INTEGER NULL,
  ADD COLUMN `preparationRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedByUserId` VARCHAR(191) NULL;

ALTER TABLE `PlatformOutreachTarget`
  MODIFY COLUMN `status` ENUM('PENDENTE', 'RESERVADO', 'ENVIADO', 'RESPONDEU', 'FALHOU', 'DESCARTADO') NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN `segment` VARCHAR(191) NULL,
  ADD COLUMN `address` TEXT NULL,
  ADD COLUMN `website` TEXT NULL,
  ADD COLUMN `sourceRowNumber` INTEGER NULL,
  ADD COLUMN `consentStatus` VARCHAR(191) NOT NULL DEFAULT 'NAO_VERIFICADO',
  ADD COLUMN `consentSource` VARCHAR(191) NULL,
  ADD COLUMN `consentEvidence` TEXT NULL,
  ADD COLUMN `consentAt` DATETIME(3) NULL,
  ADD COLUMN `generationStatus` VARCHAR(191) NOT NULL DEFAULT 'NAO_PREPARADO',
  ADD COLUMN `generationAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `generationStartedAt` DATETIME(3) NULL,
  ADD COLUMN `proposal` TEXT NULL,
  ADD COLUMN `messageText` TEXT NULL,
  ADD COLUMN `mainBenefit` VARCHAR(191) NULL,
  ADD COLUMN `aiDataUsed` JSON NULL,
  ADD COLUMN `aiAlerts` JSON NULL,
  ADD COLUMN `aiRequestId` VARCHAR(191) NULL,
  ADD COLUMN `aiInputTokens` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `aiOutputTokens` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `approvalStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `approvedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `responseCategory` VARCHAR(191) NULL,
  ADD COLUMN `responseSuggestion` TEXT NULL,
  ADD COLUMN `responseText` TEXT NULL,
  ADD COLUMN `responseClassifiedAt` DATETIME(3) NULL;
ALTER TABLE `PlatformOutreachTarget`
  ADD COLUMN `classificationAttempts` INTEGER NOT NULL DEFAULT 0;

CREATE TABLE `PlatformOutreachImportRow` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `targetId` VARCHAR(191) NULL,
  `sheet` VARCHAR(191) NOT NULL,
  `rowNumber` INTEGER NOT NULL,
  `originalData` JSON NOT NULL,
  `mappedData` JSON NULL,
  `status` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PlatformOutreachImportRow_campaignId_sheet_rowNumber_key` (`campaignId`, `sheet`, `rowNumber`),
  INDEX `PlatformOutreachImportRow_targetId_idx` (`targetId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformOutreachPrompt` (
  `id` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `systemPrompt` TEXT NOT NULL,
  `createdByUserId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `PlatformOutreachPrompt_version_key` (`version`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformOutreachSenderState` (
  `channelId` VARCHAR(191) NOT NULL,
  `nextAllowedAt` DATETIME(3) NULL,
  `inFlightTargetId` VARCHAR(191) NULL,
  `inFlightAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`channelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformOutreachAuthState` (
  `key` VARCHAR(191) NOT NULL,
  `ciphertext` LONGBLOB NOT NULL,
  `nonce` VARBINARY(12) NOT NULL,
  `tag` VARBINARY(16) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformOutreachConnectionState` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'primary',
  `desiredConnected` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DESCONECTADO',
  `phone` VARCHAR(191) NULL,
  `qrCode` TEXT NULL,
  `qrExpiresAt` DATETIME(3) NULL,
  `lastHeartbeatAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PlatformOutreachAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `targetId` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'INICIADA',
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `providerMessageId` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  UNIQUE INDEX `PlatformOutreachAttempt_targetId_key` (`targetId`),
  INDEX `PlatformOutreachAttempt_channelId_startedAt_idx` (`channelId`, `startedAt`),
  INDEX `PlatformOutreachAttempt_campaignId_startedAt_idx` (`campaignId`, `startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformOutreachImportRow` ADD CONSTRAINT `PlatformOutreachImportRow_campaignId_fkey`
  FOREIGN KEY (`campaignId`) REFERENCES `PlatformOutreachCampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PlatformOutreachImportRow` ADD CONSTRAINT `PlatformOutreachImportRow_targetId_fkey`
  FOREIGN KEY (`targetId`) REFERENCES `PlatformOutreachTarget`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `PlatformOutreachAttempt` ADD CONSTRAINT `PlatformOutreachAttempt_targetId_fkey`
  FOREIGN KEY (`targetId`) REFERENCES `PlatformOutreachTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Listas antigas não trazem prova de autorização nem aprovação individual.
-- Pausar as que estavam ativas é indispensável antes de ligar o novo worker.
UPDATE `PlatformOutreachCampaign`
SET `status` = 'PAUSADA', `nextSendAt` = NULL,
    `pausedReason` = 'Campanha antiga: revalidar autorização e mensagens antes de enviar.'
WHERE `status` = 'ENVIANDO';
