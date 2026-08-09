-- Uma instalação nova pode aplicar as migrations sem executar o seed local.
-- O plano comercial é parte essencial da contratação pública, portanto ele
-- precisa existir mesmo nessa primeira subida. O upsert não altera decisões
-- posteriores feitas no Super Admin (preço, status ou Stripe Price ID).
INSERT INTO `SoftwarePlan` (
  `id`,
  `name`,
  `slug`,
  `description`,
  `monthlyPrice`,
  `currency`,
  `features`,
  `isActive`,
  `isFeatured`,
  `createdAt`,
  `updatedAt`
)
VALUES (
  'plan_profissional_chegowia',
  'ChegowIA Profissional',
  'profissional',
  'A operação completa para delivery, salão, equipe, clientes e inteligência artificial.',
  159.90,
  'brl',
  JSON_ARRAY(
    'Pedidos delivery e atendimento no salão',
    'Gestão de mesas, cozinha e entregas em tempo real',
    'Cardápio, clientes, funcionários e relatórios',
    'Assistentes de IA operacionais e de atendimento',
    'Suporte e atualizações contínuas'
  ),
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE `id` = `id`;
