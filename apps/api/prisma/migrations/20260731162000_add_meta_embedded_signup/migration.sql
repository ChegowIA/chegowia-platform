-- Dados do fluxo oficial Meta Embedded Signup. Tokens e PIN continuam cifrados
-- no servidor; os identificadores não são expostos aos clientes da plataforma.
ALTER TABLE `MessagingChannel`
  ADD COLUMN `metaBusinessPortfolioId` VARCHAR(191) NULL,
  ADD COLUMN `metaAccessTokenExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `metaRegistrationPinEncrypted` TEXT NULL,
  ADD COLUMN `metaEmbeddedSignupAt` DATETIME(3) NULL;
