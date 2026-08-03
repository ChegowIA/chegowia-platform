ALTER TABLE `User` MODIFY `role` ENUM('SUPER_ADMIN','ADMIN','FUNCIONARIO','COZINHA','MOTOBOY','CLIENTE','REVENDEDOR') NOT NULL;

CREATE TABLE `ResellerApplication` (
  `id` VARCHAR(191) NOT NULL, `fullName` VARCHAR(191) NOT NULL, `email` VARCHAR(191) NOT NULL,
  `phone` VARCHAR(191) NOT NULL, `document` VARCHAR(191) NOT NULL, `city` VARCHAR(191) NOT NULL,
  `state` VARCHAR(191) NOT NULL, `linkedinUrl` VARCHAR(191) NULL, `resumeUrl` VARCHAR(191) NULL,
  `resumeText` TEXT NULL, `motivation` TEXT NOT NULL, `commitment` TEXT NOT NULL, `experience` TEXT NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `status` ENUM('EM_ANALISE_IA','RECUSADA_IA','REVISAO_HUMANA','APROVADA','RECUSADA') NOT NULL DEFAULT 'EM_ANALISE_IA',
  `attemptCount` INTEGER NOT NULL DEFAULT 1, `aiScore` INTEGER NULL, `aiDecision` VARCHAR(191) NULL,
  `aiFeedback` TEXT NULL, `aiAnalysis` JSON NULL, `reviewNotes` TEXT NULL, `reviewedByUserId` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ResellerApplication_email_idx`(`email`), INDEX `ResellerApplication_status_createdAt_idx`(`status`,`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResellerProfile` (
  `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `applicationId` VARCHAR(191) NULL,
  `code` VARCHAR(191) NOT NULL, `commissionRate` DECIMAL(5,4) NOT NULL DEFAULT 0.30,
  `stripeAccountId` VARCHAR(191) NULL, `stripeOnboardingOk` BOOLEAN NOT NULL DEFAULT false,
  `isActive` BOOLEAN NOT NULL DEFAULT true, `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ResellerProfile_userId_key`(`userId`), UNIQUE INDEX `ResellerProfile_applicationId_key`(`applicationId`),
  UNIQUE INDEX `ResellerProfile_code_key`(`code`), UNIQUE INDEX `ResellerProfile_stripeAccountId_key`(`stripeAccountId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SoftwarePlan` (
  `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `slug` VARCHAR(191) NOT NULL,
  `description` TEXT NULL, `monthlyPrice` DECIMAL(10,2) NOT NULL, `currency` VARCHAR(191) NOT NULL DEFAULT 'brl',
  `stripePriceId` VARCHAR(191) NULL, `features` JSON NOT NULL, `isActive` BOOLEAN NOT NULL DEFAULT true,
  `isFeatured` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `SoftwarePlan_slug_key`(`slug`),
  UNIQUE INDEX `SoftwarePlan_stripePriceId_key`(`stripePriceId`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ClientApplication` (
  `id` VARCHAR(191) NOT NULL, `companyId` VARCHAR(191) NULL, `planId` VARCHAR(191) NOT NULL,
  `resellerId` VARCHAR(191) NULL, `resellerCode` VARCHAR(191) NULL, `responsibleName` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL, `phone` VARCHAR(191) NOT NULL, `document` VARCHAR(191) NOT NULL,
  `companyName` VARCHAR(191) NOT NULL, `tradeName` VARCHAR(191) NULL, `city` VARCHAR(191) NOT NULL,
  `state` VARCHAR(191) NOT NULL, `businessType` VARCHAR(191) NOT NULL, `operationDetails` TEXT NOT NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `status` ENUM('EM_ANALISE_IA','RECUSADA_IA','REVISAO_HUMANA','APROVADA','RECUSADA') NOT NULL DEFAULT 'EM_ANALISE_IA',
  `aiScore` INTEGER NULL, `aiFeedback` TEXT NULL, `aiAnalysis` JSON NULL, `stripeSessionId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ClientApplication_companyId_key`(`companyId`), UNIQUE INDEX `ClientApplication_stripeSessionId_key`(`stripeSessionId`),
  INDEX `ClientApplication_email_idx`(`email`), INDEX `ClientApplication_status_idx`(`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ClientSubscription` (
  `id` VARCHAR(191) NOT NULL, `companyId` VARCHAR(191) NOT NULL, `planId` VARCHAR(191) NOT NULL,
  `resellerId` VARCHAR(191) NULL,
  `status` ENUM('PENDENTE','ATIVA','INADIMPLENTE','CANCELADA') NOT NULL DEFAULT 'PENDENTE',
  `stripeCustomerId` VARCHAR(191) NULL, `stripeSubscriptionId` VARCHAR(191) NULL, `referralCode` VARCHAR(191) NULL,
  `referralLockedAt` DATETIME(3) NULL, `discountEndsAt` DATETIME(3) NULL, `currentPeriodEnd` DATETIME(3) NULL,
  `canceledAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, UNIQUE INDEX `ClientSubscription_companyId_key`(`companyId`),
  UNIQUE INDEX `ClientSubscription_stripeCustomerId_key`(`stripeCustomerId`),
  UNIQUE INDEX `ClientSubscription_stripeSubscriptionId_key`(`stripeSubscriptionId`),
  INDEX `ClientSubscription_resellerId_status_idx`(`resellerId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CommissionLedger` (
  `id` VARCHAR(191) NOT NULL, `resellerId` VARCHAR(191) NOT NULL, `subscriptionId` VARCHAR(191) NOT NULL,
  `stripeInvoiceId` VARCHAR(191) NOT NULL, `grossAmount` DECIMAL(10,2) NOT NULL,
  `commissionRate` DECIMAL(5,4) NOT NULL, `commissionAmount` DECIMAL(10,2) NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'brl',
  `status` ENUM('PENDENTE','DISPONIVEL','PAGA','ESTORNADA') NOT NULL DEFAULT 'DISPONIVEL',
  `availableAt` DATETIME(3) NULL, `paidAt` DATETIME(3) NULL, `stripeTransferId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CommissionLedger_stripeInvoiceId_key`(`stripeInvoiceId`),
  INDEX `CommissionLedger_stripeTransferId_idx`(`stripeTransferId`),
  INDEX `CommissionLedger_resellerId_status_idx`(`resellerId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ResellerProspect` (
  `id` VARCHAR(191) NOT NULL, `resellerId` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL,
  `companyName` VARCHAR(191) NULL, `email` VARCHAR(191) NULL, `phone` VARCHAR(191) NULL,
  `stage` VARCHAR(191) NOT NULL DEFAULT 'NOVO', `notes` TEXT NULL, `nextContactAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ResellerProspect_resellerId_stage_idx`(`resellerId`,`stage`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SalesLead` (
  `id` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL, `companyName` VARCHAR(191) NULL,
  `email` VARCHAR(191) NOT NULL, `phone` VARCHAR(191) NOT NULL, `city` VARCHAR(191) NULL,
  `state` VARCHAR(191) NULL, `message` TEXT NOT NULL,
  `status` ENUM('DISPONIVEL','EM_ATENDIMENTO','CONVERTIDO','PERDIDO') NOT NULL DEFAULT 'DISPONIVEL',
  `resellerId` VARCHAR(191) NULL, `claimedByUserId` VARCHAR(191) NULL, `claimedAt` DATETIME(3) NULL,
  `convertedAt` DATETIME(3) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL, INDEX `SalesLead_status_createdAt_idx`(`status`,`createdAt`),
  INDEX `SalesLead_resellerId_status_idx`(`resellerId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ResellerApplication` ADD CONSTRAINT `ResellerApplication_reviewedByUserId_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ResellerProfile` ADD CONSTRAINT `ResellerProfile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE, ADD CONSTRAINT `ResellerProfile_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `ResellerApplication`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ClientApplication` ADD CONSTRAINT `ClientApplication_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE, ADD CONSTRAINT `ClientApplication_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `SoftwarePlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE, ADD CONSTRAINT `ClientApplication_resellerId_fkey` FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ClientSubscription` ADD CONSTRAINT `ClientSubscription_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE, ADD CONSTRAINT `ClientSubscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `SoftwarePlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE, ADD CONSTRAINT `ClientSubscription_resellerId_fkey` FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CommissionLedger` ADD CONSTRAINT `CommissionLedger_resellerId_fkey` FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE, ADD CONSTRAINT `CommissionLedger_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `ClientSubscription`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ResellerProspect` ADD CONSTRAINT `ResellerProspect_resellerId_fkey` FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SalesLead` ADD CONSTRAINT `SalesLead_resellerId_fkey` FOREIGN KEY (`resellerId`) REFERENCES `ResellerProfile`(`id`) ON DELETE SET NULL ON UPDATE CASCADE, ADD CONSTRAINT `SalesLead_claimedByUserId_fkey` FOREIGN KEY (`claimedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
