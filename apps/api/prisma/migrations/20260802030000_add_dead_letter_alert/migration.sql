-- Um evento Stripe que esgota as 10 tentativas para de ser reprocessado e some
-- da fila em silêncio: a fatura foi paga, o acesso não foi liberado, e ninguém
-- é avisado. O mesmo vale para o lote de repasse encerrado por esgotamento.
-- `alertedAt` marca o aviso já enviado, garantindo exatamente um alerta por
-- item mesmo com o worker rodando a cada 5 segundos.
ALTER TABLE `StripeEvent`
  ADD COLUMN `alertedAt` DATETIME(3) NULL;

ALTER TABLE `PayoutBatch`
  ADD COLUMN `alertedAt` DATETIME(3) NULL;

CREATE INDEX `StripeEvent_status_alertedAt_idx` ON `StripeEvent`(`status`, `alertedAt`);
