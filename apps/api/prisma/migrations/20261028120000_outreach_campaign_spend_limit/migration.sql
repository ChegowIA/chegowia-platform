ALTER TABLE `PlatformOutreachCampaign`
  ADD COLUMN `spendLimit` DECIMAL(12, 2) NULL,
  ADD COLUMN `spentAmount` DECIMAL(16, 6) NOT NULL DEFAULT 0;

-- Campanhas que já enviaram começam com o custo das mensagens já registradas
-- no consumo da plataforma, para o teto valer também sobre o que já saiu.
UPDATE `PlatformOutreachCampaign` c
SET c.`spentAmount` = (
  SELECT COALESCE(SUM(l.`providerAmount`), 0)
  FROM `PlatformOutreachAttempt` a
  JOIN `PlatformUsageLedger` l ON l.`externalReference` = CONCAT('platform-whatsapp:', a.`providerMessageId`)
  WHERE a.`campaignId` = c.`id` AND a.`providerMessageId` IS NOT NULL
);
