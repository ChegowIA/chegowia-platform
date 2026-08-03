ALTER TABLE `PayoutBatch`
  ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `PayoutBatch_status_nextAttemptAt_idx`
  ON `PayoutBatch`(`status`, `nextAttemptAt`);
