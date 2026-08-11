-- Contexto assumido pelo superadmin multiacesso.
--
-- Guardar no refresh token é o que faz a troca de contexto sobreviver à
-- renovação da sessão: sem isto, o próximo refresh devolveria o usuário ao
-- papel de plataforma sem aviso, no meio do trabalho dentro de uma empresa.
--
-- Nulo em toda sessão normal, que é a esmagadora maioria.

ALTER TABLE `RefreshToken`
  ADD COLUMN `assumedRole` ENUM('SUPER_ADMIN', 'ADMIN', 'FUNCIONARIO', 'COZINHA', 'MOTOBOY', 'GARCOM', 'CLIENTE', 'REVENDEDOR') NULL,
  ADD COLUMN `assumedCompanyId` VARCHAR(191) NULL;
