-- Resultado da última consulta de status do serviço na SEFAZ.
-- É o único teste que prova, antes de qualquer venda, que o certificado da
-- empresa é aceito no TLS mútuo e que o endpoint do estado responde — e que
-- não gasta numeração nem gera documento. Fica gravado para a tela de cadastro
-- mostrar quando foi e o que a SEFAZ respondeu.
ALTER TABLE `CompanyFiscalProfile`
  ADD COLUMN `sefazCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `sefazCheckStatus` VARCHAR(10) NULL,
  ADD COLUMN `sefazCheckReason` TEXT NULL;
