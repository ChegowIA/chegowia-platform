ALTER TABLE `Delivery`
  ADD COLUMN `motoboyLatitude` DOUBLE NULL,
  ADD COLUMN `motoboyLongitude` DOUBLE NULL,
  ADD COLUMN `motoboyLocationUpdatedAt` DATETIME(3) NULL;
