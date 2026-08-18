-- Percentual de redução da base de cálculo do ICMS (pRedBC).
-- O CST 20 é "com redução de base de cálculo" e o layout 4.00 exige o
-- percentual junto do CST; sem ele o XML é recusado na validação de schema da
-- SEFAZ. Fica no padrão da empresa e, opcionalmente, sobrescrito por produto —
-- mesmo desenho dos demais campos de tributação.
ALTER TABLE `CompanyFiscalProfile`
  ADD COLUMN `defaultIcmsReductionRate` DECIMAL(5, 2) NULL;

ALTER TABLE `Product`
  ADD COLUMN `icmsReductionRate` DECIMAL(5, 2) NULL;

-- O vínculo do documento fiscal com a venda deixa de ser único.
-- Uma nota rejeitada queima o número e precisa continuar registrada — é dela
-- que sai a inutilização —, mas a venda em si ainda não tem documento fiscal e
-- precisa poder ser emitida de novo. Com o índice único, essa segunda emissão
-- falhava com erro de constraint em vez de gerar a nota. A idempotência do
-- botão continua no serviço, que recusa emitir quando já existe documento vivo
-- para a mesma venda.
--
-- Os índices simples entram antes: as chaves estrangeiras se apoiam nos únicos
-- e o MySQL recusa remover um índice que ainda sustenta uma FK.
CREATE INDEX `FiscalDocument_orderId_idx` ON `FiscalDocument`(`orderId`);
CREATE INDEX `FiscalDocument_tableSessionId_companyId_idx` ON `FiscalDocument`(`tableSessionId`, `companyId`);

ALTER TABLE `FiscalDocument` DROP INDEX `FiscalDocument_orderId_key`;
ALTER TABLE `FiscalDocument` DROP INDEX `FiscalDocument_tableSessionId_key`;
ALTER TABLE `FiscalDocument` DROP INDEX `FiscalDocument_tableSessionId_companyId_key`;
