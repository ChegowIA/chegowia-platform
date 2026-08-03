-- Garçom tem um escopo próprio de salão. As permissões de mesas separam essa
-- operação dos pedidos gerais de delivery e permitem que o admin libere cada
-- seção do painel de maneira explícita.
ALTER TABLE `User`
  MODIFY `role` ENUM('SUPER_ADMIN','ADMIN','FUNCIONARIO','COZINHA','MOTOBOY','GARCOM','CLIENTE','REVENDEDOR') NOT NULL;

INSERT INTO `Permission` (`id`, `key`, `description`) VALUES
  (UUID(), 'mesas.visualizar', 'Ver mesas e comandas'),
  (UUID(), 'mesas.operar', 'Abrir mesas e operar comandas')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

-- Mantém o comportamento de usuários já existentes: quem antes tinha acesso
-- aos pedidos de mesa pelas permissões antigas recebe a permissão equivalente
-- de salão, sem liberar nada novo para quem não tinha esse acesso.
INSERT IGNORE INTO `RolePermission` (`id`, `employeeProfileId`, `permissionId`, `createdAt`)
SELECT UUID(), `employee`.`id`, `newPermission`.`id`, NOW(3)
FROM `EmployeeProfile` AS `employee`
INNER JOIN `User` AS `user` ON `user`.`id` = `employee`.`userId`
INNER JOIN `RolePermission` AS `currentPermission` ON `currentPermission`.`employeeProfileId` = `employee`.`id`
INNER JOIN `Permission` AS `currentKey` ON `currentKey`.`id` = `currentPermission`.`permissionId`
INNER JOIN `Permission` AS `newPermission` ON `newPermission`.`key` = 'mesas.visualizar'
WHERE `user`.`role` IN ('FUNCIONARIO', 'COZINHA')
  AND `currentKey`.`key` = 'pedidos.visualizar';

INSERT IGNORE INTO `RolePermission` (`id`, `employeeProfileId`, `permissionId`, `createdAt`)
SELECT UUID(), `employee`.`id`, `newPermission`.`id`, NOW(3)
FROM `EmployeeProfile` AS `employee`
INNER JOIN `User` AS `user` ON `user`.`id` = `employee`.`userId`
INNER JOIN `RolePermission` AS `currentPermission` ON `currentPermission`.`employeeProfileId` = `employee`.`id`
INNER JOIN `Permission` AS `currentKey` ON `currentKey`.`id` = `currentPermission`.`permissionId`
INNER JOIN `Permission` AS `newPermission` ON `newPermission`.`key` = 'mesas.operar'
WHERE `user`.`role` IN ('FUNCIONARIO', 'COZINHA')
  AND `currentKey`.`key` = 'pedidos.editar';
