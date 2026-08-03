ALTER TABLE `SalesLead`
  MODIFY `status` ENUM('DISPONIVEL','EM_ATENDIMENTO','PROPOSTA','CONVERTIDO','PERDIDO') NOT NULL DEFAULT 'DISPONIVEL';

ALTER TABLE `ClientApplication`
  ADD COLUMN `sourceLeadId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `ClientApplication_sourceLeadId_key`(`sourceLeadId`);

ALTER TABLE `ClientApplication`
  ADD CONSTRAINT `ClientApplication_sourceLeadId_fkey`
  FOREIGN KEY (`sourceLeadId`) REFERENCES `SalesLead`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
