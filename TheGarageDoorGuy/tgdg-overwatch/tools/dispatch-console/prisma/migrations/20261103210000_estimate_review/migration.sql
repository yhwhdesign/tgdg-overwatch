-- A dispatcher's review of a Housecall Pro estimate (reviewed-by, when, a note, and a snapshot of the estimate's
-- state at review time). Our data only; nothing is written back to Housecall Pro.
CREATE TABLE "EstimateReview" (
    "estimateId" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "reviewedFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EstimateReview_pkey" PRIMARY KEY ("estimateId")
);
