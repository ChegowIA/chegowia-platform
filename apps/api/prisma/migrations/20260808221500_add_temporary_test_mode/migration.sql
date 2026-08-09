-- Homologação fechada: uma candidatura pode ser aprovada depois da requisição
-- original, então preservamos a marca de visibilidade no banco.
ALTER TABLE `Company`
  ADD COLUMN `isTestOnly` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `ClientApplication`
  ADD COLUMN `isTestOnly` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `monthlyPriceSnapshot` DECIMAL(10, 2) NULL;

ALTER TABLE `ClientSubscription`
  ADD COLUMN `monthlyPriceSnapshot` DECIMAL(10, 2) NULL;

CREATE INDEX `Company_isActive_isTestOnly_city_state_idx`
  ON `Company`(`isActive`, `isTestOnly`, `city`, `state`);
