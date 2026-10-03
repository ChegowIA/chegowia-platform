-- CEP operacional: adiciona sem tornar registros legados inválidos. A API
-- passa a exigir 8 dígitos para novos cadastros e para qualquer alteração de
-- endereço; o nullable preserva empresas/endereço já existentes até revisão.
ALTER TABLE `Company`
  ADD COLUMN `zipCode` VARCHAR(8) NULL;

ALTER TABLE `ClientApplication`
  ADD COLUMN `zipCode` VARCHAR(8) NULL;

-- A operação demo criada pelo script oficial usa um endereço geocodificável
-- em Goiânia. O preenchimento por slug é deliberadamente estreito e não
-- altera empresas reais nem endereços de clientes.
UPDATE `Company`
  SET `addressLine` = 'Rua 1, 1',
      `city` = 'Goiânia',
      `state` = 'GO',
      `zipCode` = '74013010',
      `latitude` = -16.6784398,
      `longitude` = -49.2563466
  WHERE `slug` = 'operacao-demo-chegowia';

CREATE INDEX `Company_zipCode_idx` ON `Company`(`zipCode`);
-- Address.zipCode permanece na largura histórica para preservar qualquer
-- dado legado. A aplicação só usa CEP normalizado de oito dígitos nas novas
-- gravações e exige isso antes de calcular ou aceitar uma entrega.
CREATE INDEX `Address_zipCode_idx` ON `Address`(`zipCode`);

-- Cache de centro aproximado do CEP. Não há dados pessoais aqui: vários
-- endereços e empresas podem compartilhar o mesmo CEP.
CREATE TABLE `PostalCodeLocation` (
  `zipCode` VARCHAR(8) NOT NULL,
  `latitude` DECIMAL(10, 7) NOT NULL,
  `longitude` DECIMAL(10, 7) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`zipCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
