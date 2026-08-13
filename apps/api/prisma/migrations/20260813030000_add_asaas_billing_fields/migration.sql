-- Migração da cobrança para o Asaas.
--
-- Os campos do Stripe permanecem: os dois provedores convivem durante a
-- transição. Assinatura já criada no Stripe continua sendo cobrada por ele até
-- terminar; a partir do corte, contratação nova nasce no Asaas. Apagar os
-- campos antigos agora deixaria sem conciliação quem está pagando hoje.

-- Subconta do revendedor. O walletId endereça as transferências de comissão; a
-- chave de API é devolvida uma única vez na criação e não há como recuperá-la
-- depois, por isso é guardada cifrada.
ALTER TABLE `ResellerProfile`
  ADD COLUMN `asaasWalletId` VARCHAR(191) NULL,
  ADD COLUMN `asaasAccountId` VARCHAR(191) NULL,
  ADD COLUMN `asaasApiKeyEncrypted` TEXT NULL,
  ADD COLUMN `asaasOnboardingOk` BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX `ResellerProfile_asaasWalletId_key` ON `ResellerProfile`(`asaasWalletId`);
CREATE UNIQUE INDEX `ResellerProfile_asaasAccountId_key` ON `ResellerProfile`(`asaasAccountId`);

ALTER TABLE `ClientApplication`
  ADD COLUMN `asaasPaymentId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `ClientApplication_asaasPaymentId_key` ON `ClientApplication`(`asaasPaymentId`);

-- `asaasPaymentId` guarda a cobrança de ativação em aberto, para reaproveitar o
-- link em vez de gerar uma cobrança nova a cada clique do empresário.
ALTER TABLE `ClientSubscription`
  ADD COLUMN `asaasCustomerId` VARCHAR(191) NULL,
  ADD COLUMN `asaasSubscriptionId` VARCHAR(191) NULL,
  ADD COLUMN `asaasPaymentId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `ClientSubscription_asaasCustomerId_key` ON `ClientSubscription`(`asaasCustomerId`);
CREATE UNIQUE INDEX `ClientSubscription_asaasSubscriptionId_key` ON `ClientSubscription`(`asaasSubscriptionId`);
CREATE UNIQUE INDEX `ClientSubscription_asaasPaymentId_key` ON `ClientSubscription`(`asaasPaymentId`);

-- A comissão passa a poder nascer de uma cobrança do Asaas. `stripeInvoiceId`
-- deixa de ser obrigatório pelo mesmo motivo: um lançamento tem origem em um
-- provedor ou no outro, nunca nos dois.
ALTER TABLE `CommissionLedger`
  MODIFY `stripeInvoiceId` VARCHAR(191) NULL,
  ADD COLUMN `asaasPaymentId` VARCHAR(191) NULL,
  ADD COLUMN `asaasTransferId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `CommissionLedger_asaasPaymentId_key` ON `CommissionLedger`(`asaasPaymentId`);

ALTER TABLE `PayoutBatch`
  ADD COLUMN `asaasTransferId` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `PayoutBatch_asaasTransferId_key` ON `PayoutBatch`(`asaasTransferId`);

-- No Asaas não existe item de fatura: o consumo do período é somado ao valor da
-- cobrança seguinte. Guardar qual cobrança absorveu cada lançamento é o que
-- impede faturar o mesmo consumo duas vezes.
ALTER TABLE `UsageLedger`
  ADD COLUMN `asaasPaymentId` VARCHAR(191) NULL;
CREATE INDEX `UsageLedger_asaasPaymentId_idx` ON `UsageLedger`(`asaasPaymentId`);

-- A fila de webhooks passa a atender os dois provedores. Eventos já gravados são
-- do Stripe, que é o padrão da coluna.
ALTER TABLE `StripeEvent`
  ADD COLUMN `provider` ENUM('STRIPE', 'ASAAS') NOT NULL DEFAULT 'STRIPE';
