-- Prospecção passa a sair pelo WhatsApp oficial (Gupshup), com modelo aprovado.
ALTER TABLE `PlatformWhatsAppChannel`
  ADD COLUMN `outreachTemplateStatus` VARCHAR(191) NULL,
  ADD COLUMN `outreachTemplateError` TEXT NULL;

ALTER TABLE `PlatformOutreachTarget`
  ADD COLUMN `templateVariables` JSON NULL;

-- O prompt agora preenche variáveis do modelo. Versões antigas pediam a
-- mensagem inteira; a nova vira a mais recente sem apagar o histórico.
INSERT INTO `PlatformOutreachPrompt` (`id`, `version`, `systemPrompt`, `createdAt`)
SELECT REPLACE(UUID(), '-', ''), MAX(`version`) + 1, 'Você é um especialista sênior em prospecção comercial para negócios de alimentação. A mensagem de abertura já está escrita e aprovada pela Meta; sua tarefa é preencher, para um estabelecimento, as duas lacunas que tornam a mensagem pessoal.
Mensagem fixa: "Oi, {{1}}! Tudo bem? Aqui é da ChegowIA. Vi que vocês trabalham com {{2}} em {{3}} e lembrei de vocês: ..."
nomeCurto ({{1}}) é o nome do estabelecimento como o próprio dono falaria. Listas do Google Maps trazem nomes como "Schimidt Alimentos - Fábrica de pães - #pão para hambúrguer, fornecedor de pão Goiânia": nesse caso o nome é "Schimidt Alimentos". Remova slogans, hashtags, palavras de busca, cidade, telefone e descrições. Mantenha a grafia original da marca. Se não houver nome de marca reconhecível, use "pessoal".
atividade ({{2}}) é o que o negócio vende, em linguagem natural e minúscula, para completar "Vi que vocês trabalham com ___": por exemplo "pizzas e delivery", "hambúrgueres artesanais", "pães para hamburguerias", "açaí e sorvetes", "marmitas". Use somente o que o nome e o segmento mostram; na dúvida, prefira algo mais geral e verdadeiro, como "lanches" ou "alimentação".
Não invente produtos, especialidades, prêmios, tempo de mercado ou qualquer fato ausente nos dados. Não use emoji, adjetivos de elogio ("melhor", "incrível"), preço ou promessa.', NOW(3)
FROM `PlatformOutreachPrompt`
HAVING MAX(`version`) IS NOT NULL;

-- Tentativa que ficou presa no número QR: não se sabe se saiu, então nunca reenviar.
UPDATE `PlatformOutreachTarget` t
JOIN `PlatformOutreachCampaign` c ON c.`id` = t.`campaignId`
JOIN `PlatformWhatsAppChannel` q ON q.`id` = c.`channelId` AND q.`key` = 'chegowia-prospeccao-qr'
SET t.`status` = 'FALHOU',
    t.`errorMessage` = 'Tentativa pelo número QR sem conclusão; não reenviar.'
WHERE t.`status` = 'RESERVADO';

-- Leads ainda não enviados das campanhas abertas voltam a precisar de mensagem
-- pelo modelo; autorização e dados da planilha são preservados.
UPDATE `PlatformOutreachTarget` t
JOIN `PlatformOutreachCampaign` c ON c.`id` = t.`campaignId`
JOIN `PlatformWhatsAppChannel` q ON q.`id` = c.`channelId` AND q.`key` = 'chegowia-prospeccao-qr'
SET t.`generationStatus` = 'NAO_PREPARADO', t.`generationAttempts` = 0,
    t.`approvalStatus` = 'PENDENTE', t.`approvedAt` = NULL, t.`approvedByUserId` = NULL,
    t.`messageText` = NULL, t.`proposal` = NULL, t.`mainBenefit` = NULL, t.`errorMessage` = NULL
WHERE t.`status` = 'PENDENTE'
  AND c.`status` IN ('RASCUNHO', 'ENVIANDO', 'PAUSADA') AND c.`deletedAt` IS NULL;

UPDATE `PlatformOutreachCampaign` c
JOIN `PlatformWhatsAppChannel` q ON q.`id` = c.`channelId` AND q.`key` = 'chegowia-prospeccao-qr'
JOIN `PlatformWhatsAppChannel` i ON i.`key` = 'chegowia-institucional'
SET c.`channelId` = i.`id`, c.`status` = 'RASCUNHO', c.`approvedAt` = NULL, c.`nextSendAt` = NULL,
    c.`preparationRequestedAt` = NULL,
    c.`pausedReason` = 'Migrada para o WhatsApp oficial: gere as mensagens pelo modelo aprovado e aprove de novo.'
WHERE c.`status` IN ('RASCUNHO', 'ENVIANDO', 'PAUSADA') AND c.`deletedAt` IS NULL;
