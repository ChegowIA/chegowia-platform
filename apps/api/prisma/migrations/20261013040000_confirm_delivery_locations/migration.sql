ALTER TABLE `Company` ADD COLUMN `locationConfirmedAt` DATETIME(3) NULL;
ALTER TABLE `Address` ADD COLUMN `locationConfirmedAt` DATETIME(3) NULL;
ALTER TABLE `Order` ADD COLUMN `deliveryLatitude` DECIMAL(10,7) NULL,
    ADD COLUMN `deliveryLongitude` DECIMAL(10,7) NULL;
