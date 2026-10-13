-- A operação demo precisa aceitar pedidos de teste durante gravações a qualquer
-- hora. Só muda o horário original do setup; horários personalizados no painel
-- permanecem intactos.
UPDATE `CompanySettings` settings
JOIN `Company` company ON company.`id` = settings.`companyId`
SET settings.`openingHours` = JSON_OBJECT(
  'segunda', '00:00-00:00',
  'terca', '00:00-00:00',
  'quarta', '00:00-00:00',
  'quinta', '00:00-00:00',
  'sexta', '00:00-00:00',
  'sabado', '00:00-00:00',
  'domingo', '00:00-00:00'
)
WHERE company.`slug` = 'operacao-demo-chegowia'
  AND company.`isTestOnly` = true
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.segunda')) = '18:00-23:00'
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.terca')) = '18:00-23:00'
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.quarta')) = '18:00-23:00'
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.quinta')) = '18:00-23:00'
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.sexta')) = '18:00-00:00'
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.sabado')) = '18:00-00:00'
  AND JSON_UNQUOTE(JSON_EXTRACT(settings.`openingHours`, '$.domingo')) = '18:00-23:00';
