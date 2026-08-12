-- Custo real do WhatsApp agora que o provedor é o Gupshup.
--
-- O Gupshup cobra a taxa de plataforma dele em TODA mensagem, inclusive na de
-- serviço. Medido na carteira: 14 mensagens consumiram USD 0,014 — USD 0,001
-- cada, o que dá BRL 0,005077 na PTAX de referência (5,0773).
--
-- A mensagem de serviço estava com custo zero na tabela. Como ela é o caso mais
-- comum no atendimento reativo, a plataforma pagava o Gupshup e faturava nada em
-- cima. Os templates recebem a mesma taxa somada à tarifa da Meta.
--
-- Atualiza instalações existentes; o seed carrega os mesmos valores em bases
-- novas.

UPDATE `UsageRate`
SET `provider` = 'Gupshup + Meta Brasil', `providerUnitCost` = 0.005077
WHERE `metric` = 'WHATSAPP_SERVICO';

UPDATE `UsageRate`
SET `provider` = 'Gupshup + Meta Brasil', `providerUnitCost` = 0.040077
WHERE `metric` IN ('WHATSAPP_TEMPLATE_UTILIDADE', 'WHATSAPP_TEMPLATE_AUTENTICACAO');

UPDATE `UsageRate`
SET `provider` = 'Gupshup + Meta Brasil', `providerUnitCost` = 0.326777
WHERE `metric` = 'WHATSAPP_TEMPLATE_MARKETING';
