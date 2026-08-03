-- Normaliza documentos legados para que "12.345.678/0001-90" e
-- "12345678000190" sejam tratados como a mesma identidade.
UPDATE `Company`
SET `cnpj` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`cnpj`, '.', ''), '-', ''), '/', ''), ' ', ''), CHAR(9), '')
WHERE `cnpj` IS NOT NULL;

UPDATE `ResellerApplication`
SET `document` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`document`, '.', ''), '-', ''), '/', ''), ' ', ''), CHAR(9), '');

UPDATE `ClientApplication`
SET `document` = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(`document`, '.', ''), '-', ''), '/', ''), ' ', ''), CHAR(9), '');

-- Revendedores aprovados antes da criação do campo User.document passam a
-- participar da mesma restrição global de CPF/CNPJ.
UPDATE `User` AS `user`
INNER JOIN `ResellerProfile` AS `profile` ON `profile`.`userId` = `user`.`id`
INNER JOIN `ResellerApplication` AS `application` ON `application`.`id` = `profile`.`applicationId`
SET `user`.`document` = `application`.`document`
WHERE `user`.`document` IS NULL;
