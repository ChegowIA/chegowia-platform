-- Taxas iniciais sem valor: o super-admin informa os custos vigentes de cada
-- provedor antes de iniciar cobrança variável. INSERT IGNORE preserva qualquer
-- tabela já configurada em um ambiente existente.
INSERT IGNORE INTO `UsageRate` (
  `id`, `metric`, `provider`, `label`, `unitSize`, `providerUnitCost`, `markupPercent`, `isActive`, `createdAt`, `updatedAt`
) VALUES
  ('usage-rate-ai-input', 'IA_TOKENS_ENTRADA', 'LLM', 'IA — tokens de entrada', 1000, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-ai-output', 'IA_TOKENS_SAIDA', 'LLM', 'IA — tokens de saída', 1000, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-service', 'WHATSAPP_SERVICO', 'Meta', 'WhatsApp — mensagem de serviço', 1, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-utility', 'WHATSAPP_TEMPLATE_UTILIDADE', 'Meta', 'WhatsApp — template de utilidade', 1, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-marketing', 'WHATSAPP_TEMPLATE_MARKETING', 'Meta', 'WhatsApp — template de marketing', 1, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('usage-rate-whatsapp-authentication', 'WHATSAPP_TEMPLATE_AUTENTICACAO', 'Meta', 'WhatsApp — template de autenticação', 1, 0, 0, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
