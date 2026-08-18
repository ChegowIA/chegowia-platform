-- Marco do fim do desconto por indicação no provedor de cobrança.
-- O desconto de 15% vale pelos 3 primeiros meses; passada a janela, a
-- assinatura precisa voltar ao preço cheio no Asaas. Sem registrar quando o
-- ajuste foi feito, a varredura diária reenviaria a mesma atualização para
-- sempre, sem forma de distinguir "já ajustei" de "ainda não".
ALTER TABLE `ClientSubscription`
  ADD COLUMN `discountRemovedAt` DATETIME(3) NULL;
