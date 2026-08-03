-- Security, durable Stripe processing and auditable delivery incidents.

ALTER TABLE `User`
  ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL;

-- Existing accounts were created before e-mail verification existed. Keeping
-- them verified avoids locking legitimate users during the deployment.
UPDATE `User`
SET `emailVerifiedAt` = `createdAt`
WHERE `emailVerifiedAt` IS NULL;

CREATE TABLE `AccountToken` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `type` ENUM('VERIFICACAO_EMAIL','REDEFINICAO_SENHA','LOGIN_MFA') NOT NULL,
  `tokenHash` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AccountToken_tokenHash_key`(`tokenHash`),
  INDEX `AccountToken_userId_type_expiresAt_idx`(`userId`, `type`, `expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AccountToken`
  ADD CONSTRAINT `AccountToken_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Delivery`
  ADD COLUMN `problemReason` ENUM(
    'CLIENTE_NAO_ATENDEU',
    'ENDERECO_NAO_LOCALIZADO',
    'CLIENTE_RECUSOU',
    'VEICULO_COM_PROBLEMA',
    'PEDIDO_DANIFICADO',
    'AREA_DE_RISCO',
    'OUTRO'
  ) NULL,
  ADD COLUMN `problemDescription` TEXT NULL,
  ADD COLUMN `statusBeforeProblem` ENUM(
    'AGUARDANDO_RETIRADA',
    'RETIRADO',
    'EM_ROTA',
    'ENTREGUE',
    'PROBLEMA'
  ) NULL,
  ADD COLUMN `problemReportedAt` DATETIME(3) NULL,
  ADD COLUMN `problemResolvedAt` DATETIME(3) NULL;

ALTER TABLE `ResellerApplication`
  ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `automatedAnalysisAcceptedAt` DATETIME(3) NULL;

ALTER TABLE `ClientApplication`
  ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `automatedAnalysisAcceptedAt` DATETIME(3) NULL;

ALTER TABLE `CommissionLedger`
  MODIFY `status` ENUM('PENDENTE','PROCESSANDO','DISPONIVEL','PAGA','ESTORNADA') NOT NULL DEFAULT 'DISPONIVEL',
  ADD COLUMN `payoutBatchId` VARCHAR(191) NULL,
  ADD INDEX `CommissionLedger_payoutBatchId_idx`(`payoutBatchId`);

CREATE TABLE `PayoutBatch` (
  `id` VARCHAR(191) NOT NULL,
  `resellerId` VARCHAR(191) NOT NULL,
  `status` ENUM('PROCESSANDO','PAGO','FALHOU') NOT NULL DEFAULT 'PROCESSANDO',
  `amount` DECIMAL(10, 2) NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'brl',
  `stripeTransferId` VARCHAR(191) NULL,
  `failureReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completedAt` DATETIME(3) NULL,
  UNIQUE INDEX `PayoutBatch_stripeTransferId_key`(`stripeTransferId`),
  INDEX `PayoutBatch_resellerId_status_createdAt_idx`(`resellerId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PayoutBatch`
  ADD CONSTRAINT `PayoutBatch_resellerId_fkey`
  FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CommissionLedger`
  ADD CONSTRAINT `CommissionLedger_payoutBatchId_fkey`
  FOREIGN KEY (`payoutBatchId`) REFERENCES `PayoutBatch`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `StripeEvent` (
  `id` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('PENDENTE','PROCESSANDO','PROCESSADO','FALHOU') NOT NULL DEFAULT 'PENDENTE',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `lastError` TEXT NULL,
  `processedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `StripeEvent_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
