-- Cadastro fiscal e certificado digital A1.
--
-- Separado de `Company` porque são dados de responsabilidade contábil, com
-- outro ciclo de vida e outro papel editando. O arquivo do certificado (chave
-- privada da empresa) e o CSC ficam cifrados em repouso — nunca em disco, já
-- que o container roda com sistema de arquivos somente leitura. Os metadados
-- do certificado são extraídos no upload para permitir o alerta de expiração
-- sem precisar decifrar nada.

-- CreateTable
CREATE TABLE `CompanyFiscalProfile` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `taxRegime` ENUM('SIMPLES_NACIONAL', 'SIMPLES_NACIONAL_EXCESSO', 'REGIME_NORMAL') NOT NULL,
    `cnae` VARCHAR(7) NOT NULL,
    `stateRegistration` VARCHAR(20) NOT NULL,
    `municipalRegistration` VARCHAR(20) NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `tradeName` VARCHAR(191) NULL,
    `addressStreet` VARCHAR(191) NOT NULL,
    `addressNumber` VARCHAR(20) NOT NULL,
    `addressComplement` VARCHAR(191) NULL,
    `addressDistrict` VARCHAR(191) NOT NULL,
    `cityIbgeCode` VARCHAR(7) NOT NULL,
    `cityName` VARCHAR(191) NOT NULL,
    `state` VARCHAR(2) NOT NULL,
    `zipCode` VARCHAR(8) NOT NULL,
    `environment` ENUM('HOMOLOGACAO', 'PRODUCAO') NOT NULL DEFAULT 'HOMOLOGACAO',
    `nfceSeries` INTEGER NOT NULL DEFAULT 1,
    `nfceNextNumber` INTEGER NOT NULL DEFAULT 1,
    `cscId` VARCHAR(6) NULL,
    `cscTokenEncrypted` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CompanyFiscalProfile_companyId_key`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiscalCertificate` (
    `id` VARCHAR(191) NOT NULL,
    `companyId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `contentEncrypted` LONGTEXT NOT NULL,
    `passwordEncrypted` TEXT NOT NULL,
    `subjectName` VARCHAR(191) NOT NULL,
    `issuerName` VARCHAR(191) NOT NULL,
    `serialNumber` VARCHAR(80) NOT NULL,
    `notBefore` DATETIME(3) NOT NULL,
    `notAfter` DATETIME(3) NOT NULL,
    `status` ENUM('ATIVO', 'SUBSTITUIDO', 'REVOGADO') NOT NULL DEFAULT 'ATIVO',
    `expiryAlertedAt` DATETIME(3) NULL,
    `uploadedByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FiscalCertificate_companyId_status_idx`(`companyId`, `status`),
    INDEX `FiscalCertificate_status_notAfter_idx`(`status`, `notAfter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CompanyFiscalProfile` ADD CONSTRAINT `CompanyFiscalProfile_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FiscalCertificate` ADD CONSTRAINT `FiscalCertificate_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

