-- Todos os relatórios filtram por faixa de `createdAt` dentro da empresa
-- (reports.service.ts). Os índices existentes cobriam `[companyId, status]`,
-- então a consulta lia todos os pedidos da empresa e descartava depois — o
-- custo cresce linearmente com o histórico do lojista.
CREATE INDEX `Order_companyId_createdAt_idx` ON `Order`(`companyId`, `createdAt`);
CREATE INDEX `Delivery_companyId_createdAt_idx` ON `Delivery`(`companyId`, `createdAt`);
