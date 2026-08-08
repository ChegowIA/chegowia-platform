-- A aplicação sempre resolve a empresa pelo token/usuário no servidor. Estas
-- FKs compostas tornam a mesma regra impossível de violar também no banco:
-- uma sessão deve pertencer à mesa da própria empresa e uma rodada deve
-- pertencer à sessão da própria empresa.

ALTER TABLE `TableSession`
  DROP FOREIGN KEY `TableSession_tableId_fkey`;

ALTER TABLE `DiningOrder`
  DROP FOREIGN KEY `DiningOrder_tableSessionId_fkey`;

ALTER TABLE `RestaurantTable`
  ADD UNIQUE INDEX `RestaurantTable_id_companyId_key`(`id`, `companyId`);

ALTER TABLE `TableSession`
  ADD UNIQUE INDEX `TableSession_id_companyId_key`(`id`, `companyId`),
  ADD INDEX `TableSession_tableId_companyId_idx`(`tableId`, `companyId`);

ALTER TABLE `DiningOrder`
  ADD INDEX `DiningOrder_tableSessionId_companyId_idx`(`tableSessionId`, `companyId`);

ALTER TABLE `TableSession`
  ADD CONSTRAINT `TableSession_tableId_companyId_fkey`
  FOREIGN KEY (`tableId`, `companyId`) REFERENCES `RestaurantTable`(`id`, `companyId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `DiningOrder`
  ADD CONSTRAINT `DiningOrder_tableSessionId_companyId_fkey`
  FOREIGN KEY (`tableSessionId`, `companyId`) REFERENCES `TableSession`(`id`, `companyId`)
  ON DELETE CASCADE ON UPDATE CASCADE;
