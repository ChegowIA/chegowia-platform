-- Remove a integração direta com a Meta. O canal passa a ser exclusivamente
-- Gupshup, e o código que lia estas colunas deixou de existir.
--
-- As colunas guardavam token de acesso e PIN de registro cifrados. Deixá-las
-- para trás seria manter credencial morta em repouso sem nenhum caminho que a
-- use — pior do que apagar. Não há como reverter: reconectar pela Meta exigiria
-- reintroduzir a integração inteira.
--
-- Canais que ainda estivessem marcados como META passam a GUPSHUP: sem as
-- colunas, "META" seria um estado que nenhum código sabe atender. Eles ficam
-- pendentes de vínculo, que é o que de fato são.

UPDATE `MessagingChannel` SET `provider` = 'GUPSHUP' WHERE `provider` <> 'GUPSHUP';
UPDATE `PlatformWhatsAppChannel` SET `provider` = 'GUPSHUP' WHERE `provider` <> 'GUPSHUP';

ALTER TABLE `MessagingChannel`
  DROP INDEX `MessagingChannel_metaPhoneNumberId_key`,
  DROP COLUMN `metaPhoneNumberId`,
  DROP COLUMN `metaBusinessAccountId`,
  DROP COLUMN `metaBusinessPortfolioId`,
  DROP COLUMN `metaAccessTokenEncrypted`,
  DROP COLUMN `metaAccessTokenExpiresAt`,
  DROP COLUMN `metaRegistrationPinEncrypted`,
  DROP COLUMN `metaDisplayPhoneNumber`,
  DROP COLUMN `metaVerifiedName`,
  DROP COLUMN `metaQualityRating`,
  DROP COLUMN `metaEmbeddedSignupAt`;

ALTER TABLE `PlatformWhatsAppChannel`
  DROP INDEX `PlatformWhatsAppChannel_metaPhoneNumberId_key`,
  DROP COLUMN `metaPhoneNumberId`,
  DROP COLUMN `metaBusinessAccountId`,
  DROP COLUMN `metaAccessTokenEncrypted`,
  DROP COLUMN `metaDisplayPhoneNumber`,
  DROP COLUMN `metaVerifiedName`,
  DROP COLUMN `metaQualityRating`;

-- O enum perde o valor META agora que nenhuma linha o usa.
ALTER TABLE `MessagingChannel`
  MODIFY `provider` ENUM('GUPSHUP') NOT NULL DEFAULT 'GUPSHUP';
ALTER TABLE `PlatformWhatsAppChannel`
  MODIFY `provider` ENUM('GUPSHUP') NOT NULL DEFAULT 'GUPSHUP';
