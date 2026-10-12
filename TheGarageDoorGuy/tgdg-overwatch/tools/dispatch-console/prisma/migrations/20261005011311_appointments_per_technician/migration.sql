/*
  Warnings:

  - A unique constraint covering the columns `[hcpJobId,technicianId]` on the table `Appointment` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Appointment_hcpJobId_key";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "zip" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_hcpJobId_idx" ON "Appointment"("hcpJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_hcpJobId_technicianId_key" ON "Appointment"("hcpJobId", "technicianId");
