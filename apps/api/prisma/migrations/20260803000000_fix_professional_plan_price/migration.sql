-- O plano público da ChegowIA foi definido em R$ 159,90. Instalações criadas
-- durante a preparação de produção podiam nascer com R$ 199,90 no bootstrap.
--
-- Um Price da Stripe não pode ter o valor alterado. Quando o preço do plano
-- muda, limpamos apenas o vínculo que certamente ficou incompatível para o
-- super-admin cadastrar o novo price_ de R$ 159,90 antes de aceitar checkout.
UPDATE `SoftwarePlan`
SET
  `stripePriceId` = CASE
    WHEN `monthlyPrice` <> 159.90 THEN NULL
    ELSE `stripePriceId`
  END,
  `monthlyPrice` = 159.90,
  `updatedAt` = CURRENT_TIMESTAMP(3)
WHERE `slug` = 'profissional';
