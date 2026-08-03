-- Emissão automática da NFC-e ao marcar o pedido como pago.
--
-- Desligada por padrão de propósito: ligar antes de homologar na SEFAZ do
-- estado produziria uma rejeição a cada venda, com o cliente no balcão. O
-- lojista liga quando o cadastro estiver completo e testado em homologação.

-- AlterTable
ALTER TABLE `CompanyFiscalProfile` ADD COLUMN `autoEmit` BOOLEAN NOT NULL DEFAULT false;

