-- Comissão de revendedor só pode entrar em saque depois de o dinheiro estar
-- disponível na conta raiz do Asaas. A confirmação de pagamento, especialmente
-- em cartão, ainda não representa saldo liquidado.
ALTER TABLE `CommissionLedger`
  ADD COLUMN `externalReference` VARCHAR(191) NULL,
  ADD COLUMN `settledAt` DATETIME(3) NULL,
  ADD COLUMN `holdReason` VARCHAR(191) NULL,
  ADD COLUMN `availabilityNotifiedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `CommissionLedger_externalReference_key`
  ON `CommissionLedger`(`externalReference`);

CREATE INDEX `CommissionLedger_status_settledAt_idx`
  ON `CommissionLedger`(`status`, `settledAt`);
