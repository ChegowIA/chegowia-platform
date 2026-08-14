-- O ciclo pago precisa de início e da cobrança que o concedeu. Antes havia só
-- a data final, então a tela usava o mês-calendário e misturava consumo já
-- quitado com consumo do ciclo novo.
ALTER TABLE `ClientSubscription`
  ADD COLUMN `currentPeriodStart` DATETIME(3) NULL,
  ADD COLUMN `asaasPeriodPaymentId` VARCHAR(191) NULL;
