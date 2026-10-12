-- CreateTable
CREATE TABLE "SyncStatus" (
    "key" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorDetail" TEXT,
    "lastTrigger" TEXT,
    "lastDurationMs" INTEGER,

    CONSTRAINT "SyncStatus_pkey" PRIMARY KEY ("key")
);
