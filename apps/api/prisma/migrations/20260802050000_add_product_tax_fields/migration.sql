-- Tributação do produto.
--
-- Padrão na empresa, sobrescrita no produto: um restaurante tem centenas de
-- itens e quase todos compartilham a mesma tributação. Exigir o preenchimento
-- item a item produziria cadastro incompleto ou copiado errado — e cadastro
-- fiscal errado só aparece quando a SEFAZ rejeita, com o cliente no balcão.
--
-- O que mais varia num cardápio é o NCM: refeição pronta, refrigerante e
-- cerveja têm códigos distintos. Por isso o campo existe nos dois níveis.

-- AlterTable
ALTER TABLE `CompanyFiscalProfile` ADD COLUMN `defaultCest` VARCHAR(7) NULL,
    ADD COLUMN `defaultCfop` VARCHAR(4) NOT NULL DEFAULT '5102',
    ADD COLUMN `defaultCofinsCode` VARCHAR(2) NULL,
    ADD COLUMN `defaultCofinsRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `defaultIcmsCode` VARCHAR(3) NULL,
    ADD COLUMN `defaultIcmsRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `defaultNcm` VARCHAR(8) NULL,
    ADD COLUMN `defaultPisCode` VARCHAR(2) NULL,
    ADD COLUMN `defaultPisRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `defaultTaxOrigin` ENUM('NACIONAL', 'ESTRANGEIRA_IMPORTACAO_DIRETA', 'ESTRANGEIRA_MERCADO_INTERNO', 'NACIONAL_IMPORTACAO_ACIMA_40', 'NACIONAL_PROCESSOS_BASICOS', 'NACIONAL_IMPORTACAO_ATE_40', 'ESTRANGEIRA_IMPORTACAO_SEM_SIMILAR', 'ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR', 'NACIONAL_IMPORTACAO_ACIMA_70') NOT NULL DEFAULT 'NACIONAL',
    ADD COLUMN `defaultUnit` VARCHAR(6) NOT NULL DEFAULT 'UN';

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `cest` VARCHAR(7) NULL,
    ADD COLUMN `cfop` VARCHAR(4) NULL,
    ADD COLUMN `cofinsCode` VARCHAR(2) NULL,
    ADD COLUMN `cofinsRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `icmsCode` VARCHAR(3) NULL,
    ADD COLUMN `icmsRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `ncm` VARCHAR(8) NULL,
    ADD COLUMN `pisCode` VARCHAR(2) NULL,
    ADD COLUMN `pisRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `taxOrigin` ENUM('NACIONAL', 'ESTRANGEIRA_IMPORTACAO_DIRETA', 'ESTRANGEIRA_MERCADO_INTERNO', 'NACIONAL_IMPORTACAO_ACIMA_40', 'NACIONAL_PROCESSOS_BASICOS', 'NACIONAL_IMPORTACAO_ATE_40', 'ESTRANGEIRA_IMPORTACAO_SEM_SIMILAR', 'ESTRANGEIRA_MERCADO_INTERNO_SEM_SIMILAR', 'NACIONAL_IMPORTACAO_ACIMA_70') NULL,
    ADD COLUMN `unit` VARCHAR(6) NULL;

