-- O campo já era aceito pelos fluxos de catálogo e usado para congelar o
-- custo da venda, mas a alteração física da tabela não acompanhou a primeira
-- migração. Sem a coluna, qualquer criação que informasse custo falhava com
-- erro interno do Prisma. Mantemos o dado opcional para os cardápios que não
-- trabalham com margem.
ALTER TABLE `Product`
  ADD COLUMN `costPrice` DECIMAL(10, 2) NULL;
