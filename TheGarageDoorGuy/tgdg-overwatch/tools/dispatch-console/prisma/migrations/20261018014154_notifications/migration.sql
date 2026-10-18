-- CreateTable
CREATE TABLE "NotifyRecipient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifyRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotifySent" (
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotifySent_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotifyRecipient_topic_key" ON "NotifyRecipient"("topic");

-- CreateIndex
CREATE INDEX "NotifySent_sentAt_idx" ON "NotifySent"("sentAt");
