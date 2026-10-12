-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'job',
ADD COLUMN     "label" TEXT;
