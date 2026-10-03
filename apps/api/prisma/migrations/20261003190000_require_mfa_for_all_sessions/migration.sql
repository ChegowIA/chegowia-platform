-- Uma sessão anterior à política de MFA não pode ser renovada silenciosamente.
-- O campo fica nulo nos registros existentes; o serviço recusa esses cookies e
-- exige login + código uma vez. Novas sessões sempre gravam este instante.
ALTER TABLE `RefreshToken`
  ADD COLUMN `sessionStartedAt` DATETIME(3) NULL;
