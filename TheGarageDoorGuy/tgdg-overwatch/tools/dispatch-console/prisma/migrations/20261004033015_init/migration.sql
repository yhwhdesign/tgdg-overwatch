-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL,
    "hcpEmployeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Technician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZipCoverage" (
    "id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZipCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "hcpJobId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "hcpEventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Technician_hcpEmployeeId_key" ON "Technician"("hcpEmployeeId");

-- CreateIndex
CREATE INDEX "ZipCoverage_zip_idx" ON "ZipCoverage"("zip");

-- CreateIndex
CREATE UNIQUE INDEX "ZipCoverage_zip_technicianId_key" ON "ZipCoverage"("zip", "technicianId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_hcpJobId_key" ON "Appointment"("hcpJobId");

-- CreateIndex
CREATE INDEX "Appointment_technicianId_startTime_idx" ON "Appointment"("technicianId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_hcpEventId_key" ON "WebhookEvent"("hcpEventId");

-- AddForeignKey
ALTER TABLE "ZipCoverage" ADD CONSTRAINT "ZipCoverage_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
