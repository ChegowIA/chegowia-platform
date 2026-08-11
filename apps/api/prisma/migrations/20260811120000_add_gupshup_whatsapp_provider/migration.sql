-- Suporte a BSP no canal de WhatsApp. Canais existentes continuam em META, que
-- é o caminho já validado; GUPSHUP entra apenas nos canais conectados pelo novo
-- fluxo de onboarding, sem tocar em quem já está no ar.
--
-- O app token do Gupshup expira em 24h. Guardamos cifrado com a mesma chave dos
-- tokens Meta (WHATSAPP_TOKEN_ENCRYPTION_KEY) e renovamos sob demanda, para não
-- bater na Partner API a cada mensagem enviada.

ALTER TABLE `MessagingChannel`
  ADD COLUMN `provider` ENUM('META', 'GUPSHUP') NOT NULL DEFAULT 'META',
  ADD COLUMN `gupshupAppId` VARCHAR(191) NULL,
  ADD COLUMN `gupshupAppName` VARCHAR(191) NULL,
  ADD COLUMN `gupshupAppTokenEncrypted` TEXT NULL,
  ADD COLUMN `gupshupAppTokenExpiresAt` DATETIME(3) NULL;

-- Único global: um app do Gupshup pertence a uma única empresa, mesmo critério
-- já aplicado a metaPhoneNumberId para impedir sequestro de canal entre tenants.
CREATE UNIQUE INDEX `MessagingChannel_gupshupAppId_key` ON `MessagingChannel`(`gupshupAppId`);

ALTER TABLE `PlatformWhatsAppChannel`
  ADD COLUMN `provider` ENUM('META', 'GUPSHUP') NOT NULL DEFAULT 'META',
  ADD COLUMN `gupshupAppId` VARCHAR(191) NULL,
  ADD COLUMN `gupshupAppName` VARCHAR(191) NULL,
  ADD COLUMN `gupshupAppTokenEncrypted` TEXT NULL,
  ADD COLUMN `gupshupAppTokenExpiresAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `PlatformWhatsAppChannel_gupshupAppId_key` ON `PlatformWhatsAppChannel`(`gupshupAppId`);
