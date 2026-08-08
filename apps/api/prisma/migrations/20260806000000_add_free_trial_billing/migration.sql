-- O teste gratuito cria a empresa sem um checkout prévio. O status e as datas
-- permitem liberar tudo por sete dias e bloquear automaticamente depois.
ALTER TABLE `ClientSubscription`
  MODIFY `status` ENUM('PENDENTE','EM_TESTE','ATIVA','INADIMPLENTE','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN `trialStartedAt` DATETIME(3) NULL,
  ADD COLUMN `trialEndsAt` DATETIME(3) NULL,
  ADD COLUMN `stripeCheckoutSessionId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `ClientSubscription_stripeCheckoutSessionId_key` (`stripeCheckoutSessionId`),
  ADD INDEX `ClientSubscription_status_trialEndsAt_idx` (`status`, `trialEndsAt`);

-- Não apagamos o valor do consumo do teste: a plataforma continua enxergando
-- custo real de DeepSeek/Meta e o empresário recebe transparência. A marca
-- abaixo impede que essas linhas sejam sincronizadas para uma fatura futura.
ALTER TABLE `UsageLedger`
  ADD COLUMN `trialCoveredAt` DATETIME(3) NULL,
  ADD INDEX `UsageLedger_companyId_trialCoveredAt_status_idx` (`companyId`, `trialCoveredAt`, `status`);
