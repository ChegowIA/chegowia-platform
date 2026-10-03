-- A operação demonstrativa é a única empresa de teste liberada de forma
-- controlada. Estes caminhos apontam para assets estáticos versionados junto
-- ao site e não para arquivos externos ou uploads efêmeros.
UPDATE `Company`
SET `logoUrl` = '/assets/demo/pizzaria-exemplo-chegowia-logo.webp'
WHERE `slug` = 'operacao-demo-chegowia'
  AND `isTestOnly` = true;

UPDATE `Product`
SET `imageUrl` = '/assets/demo/pizza-especial-chegowia.webp'
WHERE `name` = 'Pizza Especial ChegowIA'
  AND `companyId` IN (
    SELECT `id`
    FROM `Company`
    WHERE `slug` = 'operacao-demo-chegowia'
      AND `isTestOnly` = true
  );

UPDATE `Product`
SET `imageUrl` = '/assets/demo/refrigerante-lata-chegowia.webp'
WHERE `name` = 'Refrigerante Lata'
  AND `companyId` IN (
    SELECT `id`
    FROM `Company`
    WHERE `slug` = 'operacao-demo-chegowia'
      AND `isTestOnly` = true
  );
