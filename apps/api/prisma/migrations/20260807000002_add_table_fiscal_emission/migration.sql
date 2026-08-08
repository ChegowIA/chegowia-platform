-- Dados de recebimento da mesa. A NFC-e precisa registrar a forma real de
-- pagamento e, quando solicitado, o CPF/CNPJ informado pelo consumidor.
ALTER TABLE `TableSession`
  ADD COLUMN `customerDocument` VARCHAR(14) NULL,
  ADD COLUMN `paymentMethod` ENUM('DINHEIRO', 'CARTAO_ENTREGA', 'PIX_MANUAL') NULL,
  ADD COLUMN `paidAt` DATETIME(3) NULL;

-- Uma NFC-e de mesa pertence à mesma empresa da comanda. A chave composta
-- materializa no banco a defesa que o service já faz em cada consulta.
ALTER TABLE `FiscalDocument`
  ADD UNIQUE INDEX `FiscalDocument_tableSessionId_companyId_key`(`tableSessionId`, `companyId`),
  ADD CONSTRAINT `FiscalDocument_tableSessionId_companyId_fkey`
  FOREIGN KEY (`tableSessionId`, `companyId`) REFERENCES `TableSession`(`id`, `companyId`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
