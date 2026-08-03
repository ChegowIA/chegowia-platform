-- Preserva cada ocorrência de entrega para auditoria, mesmo quando uma nova
-- ocorrência acontece depois da primeira ter sido resolvida.
CREATE TABLE `DeliveryIncident` (
  `id` VARCHAR(191) NOT NULL,
  `deliveryId` VARCHAR(191) NOT NULL,
  `previousStatus` ENUM(
    'AGUARDANDO_RETIRADA',
    'RETIRADO',
    'EM_ROTA',
    'ENTREGUE',
    'PROBLEMA'
  ) NOT NULL,
  `reason` ENUM(
    'CLIENTE_NAO_ATENDEU',
    'ENDERECO_NAO_LOCALIZADO',
    'CLIENTE_RECUSOU',
    'VEICULO_COM_PROBLEMA',
    'PEDIDO_DANIFICADO',
    'AREA_DE_RISCO',
    'OUTRO'
  ) NOT NULL,
  `description` TEXT NULL,
  `reportedByUserId` VARCHAR(191) NOT NULL,
  `reportedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolvedAt` DATETIME(3) NULL,
  `resolvedByUserId` VARCHAR(191) NULL,
  INDEX `DeliveryIncident_deliveryId_reportedAt_idx`(`deliveryId`, `reportedAt`),
  INDEX `DeliveryIncident_reportedByUserId_idx`(`reportedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DeliveryIncident`
  ADD CONSTRAINT `DeliveryIncident_deliveryId_fkey`
  FOREIGN KEY (`deliveryId`) REFERENCES `Delivery`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
