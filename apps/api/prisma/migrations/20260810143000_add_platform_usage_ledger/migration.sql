-- Custos da própria ChegowIA no seu número institucional. Esta tabela é
-- separada de UsageLedger porque aquele ledger é faturável e exige companyId.

CREATE TABLE `PlatformUsageLedger` (
  `id` VARCHAR(191) NOT NULL,
  `channelId` VARCHAR(191) NOT NULL,
  `usageRateId` VARCHAR(191) NULL,
  `source` ENUM('IA', 'WHATSAPP') NOT NULL,
  `metric` ENUM(
    'IA_TOKENS_ENTRADA',
    'IA_TOKENS_ENTRADA_CACHE',
    'IA_TOKENS_SAIDA',
    'WHATSAPP_SERVICO',
    'WHATSAPP_TEMPLATE_UTILIDADE',
    'WHATSAPP_TEMPLATE_MARKETING',
    'WHATSAPP_TEMPLATE_AUTENTICACAO'
  ) NOT NULL,
  `quantity` DECIMAL(18, 6) NOT NULL,
  `providerAmount` DECIMAL(16, 6) NOT NULL DEFAULT 0,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'brl',
  `externalReference` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PlatformUsageLedger_externalReference_key`(`externalReference`),
  INDEX `PlatformUsageLedger_channelId_createdAt_idx`(`channelId`, `createdAt`),
  INDEX `PlatformUsageLedger_source_metric_createdAt_idx`(`source`, `metric`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PlatformUsageLedger`
  ADD CONSTRAINT `PlatformUsageLedger_channelId_fkey`
  FOREIGN KEY (`channelId`) REFERENCES `PlatformWhatsAppChannel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `PlatformUsageLedger_usageRateId_fkey`
  FOREIGN KEY (`usageRateId`) REFERENCES `UsageRate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
