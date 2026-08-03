-- Custo do produto, custo unitário na venda e resumo congelado do turno.
--
-- `Product.costPrice` é opcional de propósito: sem custo cadastrado o sistema
-- mostra faturamento e nunca chama de lucro. Número de lucro sem custo é chute
-- com cara de relatório, e é o tipo de número que alguém usa para decidir
-- preço.
--
-- `OrderItem.unitCost` fotografa o custo no instante da venda. Consultar o
-- custo atual na hora de calcular a margem reescreveria o resultado de um mês
-- já fechado toda vez que o lojista atualizasse uma compra.
--
-- `CashSession.summary` guarda o resultado do turno como documento. É o que
-- ele é: um fechamento, imutável — não uma consulta que se refaz e dá outro
-- número se um pedido for editado depois.

-- AlterTable
ALTER TABLE `CashSession` ADD COLUMN `summary` JSON NULL;

-- AlterTable
ALTER TABLE `OrderItem` ADD COLUMN `unitCost` DECIMAL(10, 2) NULL;

