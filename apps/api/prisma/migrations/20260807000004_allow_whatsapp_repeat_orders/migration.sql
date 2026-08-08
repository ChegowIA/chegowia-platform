-- Uma conversa de WhatsApp pode ter vários pedidos ao longo do tempo. O
-- histórico permanece ligado ao pedido original, enquanto `activeKey` deixa
-- apenas um carrinho aberto por conversa/empresa.

ALTER TABLE `WhatsAppOrderDraft`
  DROP INDEX `WhatsAppOrderDraft_conversationId_key`,
  DROP INDEX `WhatsAppOrderDraft_conversationId_companyId_key`,
  ADD COLUMN `activeKey` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `WhatsAppOrderDraft_activeKey_key`(`activeKey`),
  ADD INDEX `WhatsAppOrderDraft_conversationId_companyId_status_updatedAt_idx`(`conversationId`, `companyId`, `status`, `updatedAt`);

UPDATE `WhatsAppOrderDraft`
  SET `activeKey` = CONCAT(`companyId`, ':', `conversationId`)
  WHERE `status` IN ('MONTANDO', 'AGUARDANDO_CONFIRMACAO')
    AND `activeKey` IS NULL;
