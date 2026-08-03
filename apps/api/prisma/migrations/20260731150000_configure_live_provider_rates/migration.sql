-- Custos oficiais vigentes em 31/07/2026, cobrados sem margem adicional.
-- DeepSeek V4 Flash: USD 0,14/M input cache miss, USD 0,0028/M cache hit
-- e USD 0,28/M output, convertidos por PTAX de venda 5,0773 BRL/USD.
-- Meta WhatsApp Brasil: serviço gratuito; utilidade/autenticação R$ 0,0350;
-- marketing R$ 0,3217 (primeira faixa de volume).

ALTER TABLE `UsageRate`
  MODIFY `metric` ENUM(
    'IA_TOKENS_ENTRADA',
    'IA_TOKENS_ENTRADA_CACHE',
    'IA_TOKENS_SAIDA',
    'WHATSAPP_SERVICO',
    'WHATSAPP_TEMPLATE_UTILIDADE',
    'WHATSAPP_TEMPLATE_MARKETING',
    'WHATSAPP_TEMPLATE_AUTENTICACAO'
  ) NOT NULL;

ALTER TABLE `UsageLedger`
  MODIFY `metric` ENUM(
    'IA_TOKENS_ENTRADA',
    'IA_TOKENS_ENTRADA_CACHE',
    'IA_TOKENS_SAIDA',
    'WHATSAPP_SERVICO',
    'WHATSAPP_TEMPLATE_UTILIDADE',
    'WHATSAPP_TEMPLATE_MARKETING',
    'WHATSAPP_TEMPLATE_AUTENTICACAO'
  ) NOT NULL;

INSERT INTO `UsageRate` (
  `id`, `metric`, `provider`, `label`, `unitSize`, `providerUnitCost`, `markupPercent`, `isActive`, `createdAt`, `updatedAt`
) VALUES
  ('usage-rate-ai-input', 'IA_TOKENS_ENTRADA', 'DeepSeek V4 Flash', 'IA — entrada sem cache (1M tokens)', 1000000, 0.710822, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-ai-cache-hit', 'IA_TOKENS_ENTRADA_CACHE', 'DeepSeek V4 Flash', 'IA — entrada com cache (1M tokens)', 1000000, 0.014216, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-ai-output', 'IA_TOKENS_SAIDA', 'DeepSeek V4 Flash', 'IA — saída (1M tokens)', 1000000, 1.421644, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-service', 'WHATSAPP_SERVICO', 'Meta WhatsApp Brasil', 'WhatsApp — mensagem de serviço', 1, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-utility', 'WHATSAPP_TEMPLATE_UTILIDADE', 'Meta WhatsApp Brasil', 'WhatsApp — template de utilidade', 1, 0.035, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-marketing', 'WHATSAPP_TEMPLATE_MARKETING', 'Meta WhatsApp Brasil', 'WhatsApp — template de marketing', 1, 0.3217, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-authentication', 'WHATSAPP_TEMPLATE_AUTENTICACAO', 'Meta WhatsApp Brasil', 'WhatsApp — template de autenticação', 1, 0.035, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  `provider` = VALUES(`provider`),
  `label` = VALUES(`label`),
  `unitSize` = VALUES(`unitSize`),
  `providerUnitCost` = VALUES(`providerUnitCost`),
  `markupPercent` = VALUES(`markupPercent`),
  `isActive` = VALUES(`isActive`),
  `updatedAt` = CURRENT_TIMESTAMP(3);
