-- Documentos são persistidos apenas com dígitos. Índices únicos também
-- protegem contra concorrência entre duas requisições de cadastro.
ALTER TABLE `User` ADD COLUMN `document` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `User_document_key` ON `User`(`document`);
CREATE UNIQUE INDEX `Company_cnpj_key` ON `Company`(`cnpj`);
