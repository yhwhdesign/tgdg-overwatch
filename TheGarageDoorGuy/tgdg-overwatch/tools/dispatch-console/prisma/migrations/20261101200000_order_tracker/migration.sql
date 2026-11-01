-- Order tracker (Admin only): vendors and orders, typed in by hand.
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "portalUrl" TEXT,
    "accountNumber" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'customer',
    "status" TEXT NOT NULL DEFAULT 'to-order',
    "poNumber" TEXT,
    "vendorId" TEXT,
    "jobNumber" TEXT,
    "estimateNumber" TEXT,
    "items" TEXT NOT NULL,
    "costCents" INTEGER,
    "orderedOn" TEXT,
    "expectedOn" TEXT,
    "arrivedOn" TEXT,
    "trackingNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_vendorId_idx" ON "Order"("vendorId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
