-- Margem da plataforma sobre o consumo variável.
--
-- As taxas nasceram com `markupPercent = 0`, ou seja, repasse puro do custo do
-- provedor: IA e WhatsApp eram custo da plataforma, não produto.
--
-- IA a 200% porque o custo absoluto é irrisório — uma conversa de 3 mil tokens
-- custa R$ 0,0025, e triplicada continua invisível no boleto do lojista. A
-- margem existe para absorver oscilação de câmbio (as taxas são convertidas
-- por PTAX) e troca de modelo, que muda o custo de um dia para o outro.
--
-- WhatsApp a 30% porque ali o custo já é relevante: um template de marketing
-- custa R$ 0,3217 por entrega. Margem alta tornaria disparo em massa
-- proibitivo, e o lojista simplesmente deixaria de usar o recurso.
--
-- O `WHERE markupPercent = 0` protege quem já ajustou o preço pelo painel:
-- esta migração configura o que nunca foi configurado, não sobrescreve
-- decisão de preço tomada depois.

UPDATE `UsageRate`
SET `markupPercent` = 200.0000
WHERE `metric` IN ('IA_TOKENS_ENTRADA', 'IA_TOKENS_ENTRADA_CACHE', 'IA_TOKENS_SAIDA')
  AND `markupPercent` = 0;

UPDATE `UsageRate`
SET `markupPercent` = 30.0000
WHERE `metric` IN (
    'WHATSAPP_SERVICO',
    'WHATSAPP_TEMPLATE_UTILIDADE',
    'WHATSAPP_TEMPLATE_MARKETING',
    'WHATSAPP_TEMPLATE_AUTENTICACAO'
  )
  AND `markupPercent` = 0;
