-- Acrescenta os produtos somente à operação demonstrativa isolada já existente.
-- Não modifica o endereço, as contas, os pedidos nem produtos de outras lojas.
INSERT INTO `Category` (`id`, `companyId`, `name`, `description`, `position`, `isActive`, `createdAt`, `updatedAt`)
SELECT 'demo_category_entradas_20261013', c.`id`, 'Entradas', 'Para começar bem a refeição.', 3, true, NOW(3), NOW(3)
FROM `Company` c
WHERE c.`slug` = 'operacao-demo-chegowia' AND c.`isTestOnly` = true
  AND NOT EXISTS (
    SELECT 1 FROM `Category` existing
    WHERE existing.`companyId` = c.`id` AND existing.`name` = 'Entradas'
  );

INSERT INTO `Category` (`id`, `companyId`, `name`, `description`, `position`, `isActive`, `createdAt`, `updatedAt`)
SELECT 'demo_category_sobremesas_20261013', c.`id`, 'Sobremesas', 'Um final doce para o pedido.', 4, true, NOW(3), NOW(3)
FROM `Company` c
WHERE c.`slug` = 'operacao-demo-chegowia' AND c.`isTestOnly` = true
  AND NOT EXISTS (
    SELECT 1 FROM `Category` existing
    WHERE existing.`companyId` = c.`id` AND existing.`name` = 'Sobremesas'
  );

INSERT INTO `Product`
  (`id`, `companyId`, `categoryId`, `name`, `description`, `price`, `imageUrl`, `isActive`, `isFeatured`, `createdAt`, `updatedAt`)
SELECT REPLACE(UUID(), '-', ''), c.`id`,
  (SELECT category.`id` FROM `Category` category
   WHERE category.`companyId` = c.`id` AND category.`name` = seed.category
   ORDER BY category.`createdAt` ASC LIMIT 1),
  seed.name, seed.description, seed.price, seed.imageUrl, true, seed.isFeatured, NOW(3), NOW(3)
FROM `Company` c
JOIN (
  SELECT 'Pizzas' category, 'Pizza Margherita' name,
    'Molho de tomate, mussarela, manjericão fresco e azeite.' description,
    42.90 price, '/assets/demo/pizza-margherita.webp' imageUrl, true isFeatured
  UNION ALL SELECT 'Pizzas', 'Pizza Calabresa Artesanal',
    'Calabresa fatiada, cebola roxa, mussarela e orégano.',
    46.90, '/assets/demo/pizza-calabresa-artesanal.webp', false
  UNION ALL SELECT 'Pizzas', 'Pizza Quatro Queijos',
    'Mussarela, provolone, gorgonzola e parmesão gratinados.',
    52.90, '/assets/demo/pizza-quatro-queijos.webp', false
  UNION ALL SELECT 'Pizzas', 'Pizza Vegetariana',
    'Abobrinha, pimentões, cogumelos, tomate-cereja e manjericão.',
    47.90, '/assets/demo/pizza-vegetariana.webp', false
  UNION ALL SELECT 'Entradas', 'Pão de Alho Gratinado',
    'Pães dourados com creme de alho, mussarela e ervas.',
    18.90, '/assets/demo/pao-de-alho-gratinado.webp', false
  UNION ALL SELECT 'Entradas', 'Bruschetta de Tomate',
    'Torradas artesanais com tomate fresco, manjericão e azeite.',
    22.90, '/assets/demo/bruschetta-de-tomate.webp', false
  UNION ALL SELECT 'Bebidas', 'Limonada da Casa',
    'Limonada fresca com gelo e hortelã, 400 ml.',
    11.90, '/assets/demo/limonada-da-casa.webp', false
  UNION ALL SELECT 'Bebidas', 'Suco Natural de Laranja',
    'Laranja espremida na hora, 400 ml.',
    13.90, '/assets/demo/suco-natural-de-laranja.webp', false
  UNION ALL SELECT 'Sobremesas', 'Brownie com Sorvete',
    'Brownie de chocolate quente com sorvete de baunilha.',
    24.90, '/assets/demo/brownie-com-sorvete.webp', false
  UNION ALL SELECT 'Sobremesas', 'Pudim de Leite',
    'Pudim cremoso de leite condensado com calda de caramelo.',
    15.90, '/assets/demo/pudim-de-leite.webp', false
) seed
WHERE c.`slug` = 'operacao-demo-chegowia' AND c.`isTestOnly` = true
  AND EXISTS (
    SELECT 1 FROM `Category` category
    WHERE category.`companyId` = c.`id` AND category.`name` = seed.category
  )
  AND NOT EXISTS (
    SELECT 1 FROM `Product` existing
    WHERE existing.`companyId` = c.`id` AND existing.`name` = seed.name
  );
