-- Emissão de NFC-e e controle de caixa.
--
-- FiscalDocument guarda o XML assinado e o protocolo porque a lei exige guarda
-- por cinco anos e porque, sem o XML original, nem cancelamento nem consulta
-- posterior têm como ser montados. `accessKey` é única no sistema: chave
-- repetida é rejeição garantida na SEFAZ.
--
-- O status RASCUNHO existe porque a numeração é reservada antes do envio. Um
-- número queimado sem documento vira inutilização pendente, não um buraco
-- silencioso na sequência — que a fiscalização cobra.
--
-- CashSession congela os valores esperados no fechamento em vez de recalcular
-- sob demanda: recalcular daria número diferente se um pedido fosse alterado
-- depois, e a conferência de caixa precisa ser uma foto do momento.

-- CreateTable
CREATE TABLE `FiscalDocument` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `tableSessionId` VARCHAR(191) NULL,
    `status` ENUM('RASCUNHO', 'ASSINADA', 'ENVIANDO', 'AUTORIZADA', 'REJEITADA', 'DENEGADA', 'CANCELADA', 'CONTINGENCIA', 'INUTILIZADA') NOT NULL DEFAULT 'RASCUNHO',
    `emissionType` ENUM('NORMAL', 'CONTINGENCIA_OFFLINE') NOT NULL DEFAULT 'NORMAL',
    `environment` ENUM('HOMOLOGACAO', 'PRODUCAO') NOT NULL,
    `series` INTEGER NOT NULL,
    `number` INTEGER NOT NULL,
    `accessKey` VARCHAR(44) NULL,
    `numericCode` VARCHAR(8) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL,
    `totalAmount` DECIMAL(10, 2) NOT NULL,
    `icmsAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `pisAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `cofinsAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `xml` LONGTEXT NULL,
    `protocolXml` LONGTEXT NULL,
    `protocolNumber` VARCHAR(20) NULL,
    `authorizedAt` DATETIME(3) NULL,
    `qrCodeUrl` TEXT NULL,
    `statusCode` VARCHAR(10) NULL,
    `statusReason` TEXT NULL,
    `actionHint` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `alertedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FiscalDocument_orderId_key`(`orderId`),
    UNIQUE INDEX `FiscalDocument_tableSessionId_key`(`tableSessionId`),
    UNIQUE INDEX `FiscalDocument_accessKey_key`(`accessKey`),
    INDEX `FiscalDocument_companyId_status_createdAt_idx`(`companyId`, `status`, `createdAt`),
    INDEX `FiscalDocument_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    UNIQUE INDEX `FiscalDocument_companyId_environment_series_number_key`(`companyId`, `environment`, `series`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiscalDocumentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NULL,
    `type` ENUM('CANCELAMENTO', 'CARTA_CORRECAO', 'INUTILIZACAO') NOT NULL,
    `status` ENUM('PENDENTE', 'REGISTRADO', 'REJEITADO') NOT NULL DEFAULT 'PENDENTE',
    `sequence` INTEGER NOT NULL DEFAULT 1,
    `reason` TEXT NOT NULL,
    `rangeStart` INTEGER NULL,
    `rangeEnd` INTEGER NULL,
    `protocolNumber` VARCHAR(20) NULL,
    `statusCode` VARCHAR(10) NULL,
    `statusReason` TEXT NULL,
    `xml` LONGTEXT NULL,
    `protocolXml` LONGTEXT NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `registeredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FiscalDocumentEvent_companyId_type_createdAt_idx`(`companyId`, `type`, `createdAt`),
    INDEX `FiscalDocumentEvent_documentId_idx`(`documentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashRegister` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CashRegister_companyId_isActive_idx`(`companyId`, `isActive`),
    UNIQUE INDEX `CashRegister_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashSession` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `cashRegisterId` VARCHAR(191) NOT NULL,
    `status` ENUM('ABERTO', 'FECHADO') NOT NULL DEFAULT 'ABERTO',
    `openingAmount` DECIMAL(10, 2) NOT NULL,
    `countedAmount` DECIMAL(10, 2) NULL,
    `expectedCash` DECIMAL(10, 2) NULL,
    `expectedCard` DECIMAL(10, 2) NULL,
    `expectedPix` DECIMAL(10, 2) NULL,
    `difference` DECIMAL(10, 2) NULL,
    `notes` TEXT NULL,
    `openedByUserId` VARCHAR(191) NOT NULL,
    `closedByUserId` VARCHAR(191) NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CashSession_companyId_status_openedAt_idx`(`companyId`, `status`, `openedAt`),
    INDEX `CashSession_cashRegisterId_status_idx`(`cashRegisterId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CashMovement` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `cashSessionId` VARCHAR(191) NOT NULL,
    `type` ENUM('SANGRIA', 'SUPRIMENTO', 'AJUSTE') NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `reason` TEXT NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CashMovement_cashSessionId_createdAt_idx`(`cashSessionId`, `createdAt`),
    INDEX `CashMovement_companyId_createdAt_idx`(`companyId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FiscalDocument` ADD CONSTRAINT `FiscalDocument_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FiscalDocument` ADD CONSTRAINT `FiscalDocument_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FiscalDocumentEvent` ADD CONSTRAINT `FiscalDocumentEvent_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `FiscalDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashRegister` ADD CONSTRAINT `CashRegister_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashSession` ADD CONSTRAINT `CashSession_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashSession` ADD CONSTRAINT `CashSession_cashRegisterId_fkey` FOREIGN KEY (`cashRegisterId`) REFERENCES `CashRegister`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CashMovement` ADD CONSTRAINT `CashMovement_cashSessionId_fkey` FOREIGN KEY (`cashSessionId`) REFERENCES `CashSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

