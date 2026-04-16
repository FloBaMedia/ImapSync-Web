ALTER TABLE "MigrationJob" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "MigrationJob" ADD COLUMN "queueGroup" TEXT;

CREATE INDEX "MigrationJob_status_scheduledAt_idx" ON "MigrationJob"("status", "scheduledAt");
CREATE INDEX "MigrationJob_queueGroup_status_idx" ON "MigrationJob"("queueGroup", "status");
