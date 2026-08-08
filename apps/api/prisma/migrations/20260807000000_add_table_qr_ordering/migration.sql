-- QR público por mesa: o token é opaco e único, portanto a URL nunca expõe o
-- id interno da mesa. As mesas existentes já saem da migração com um QR válido.
ALTER TABLE `RestaurantTable`
  ADD COLUMN `qrToken` VARCHAR(191) NULL;

UPDATE `RestaurantTable`
SET `qrToken` = CONCAT('mesa_', REPLACE(UUID(), '-', ''))
WHERE `qrToken` IS NULL;

ALTER TABLE `RestaurantTable`
  MODIFY `qrToken` VARCHAR(191) NOT NULL,
  ADD UNIQUE INDEX `RestaurantTable_qrToken_key`(`qrToken`);

-- Uma mesa criada pelo próprio cliente não possui usuário interno como autor.
-- O atendente é uma responsabilidade explícita, que controla o fechamento.
ALTER TABLE `TableSession`
  MODIFY `openedByUserId` VARCHAR(191) NULL,
  ADD COLUMN `attendantUserId` VARCHAR(191) NULL,
  ADD COLUMN `openedFromQr` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD INDEX `TableSession_companyId_attendantUserId_status_idx`(`companyId`, `attendantUserId`, `status`);

UPDATE `TableSession`
SET `attendantUserId` = `openedByUserId`
WHERE `attendantUserId` IS NULL AND `openedByUserId` IS NOT NULL;

ALTER TABLE `TableSession`
  ADD CONSTRAINT `TableSession_attendantUserId_fkey`
  FOREIGN KEY (`attendantUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Rodadas do QR também não têm um criador interno. A origem mantém o contexto
-- visível para cozinha e salão sem precisar inferir pelo campo nulo.
ALTER TABLE `DiningOrder`
  MODIFY `createdByUserId` VARCHAR(191) NULL,
  ADD COLUMN `source` ENUM('EQUIPE', 'QR_MESA') NOT NULL DEFAULT 'EQUIPE',
  ADD INDEX `DiningOrder_companyId_source_idx`(`companyId`, `source`);
