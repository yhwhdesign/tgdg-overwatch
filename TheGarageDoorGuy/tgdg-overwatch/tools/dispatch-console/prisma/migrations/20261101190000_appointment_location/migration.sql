-- Each job's map point from Housecall Pro, used to measure drive time when routing a new customer.
-- Nullable: events and jobs without a point keep using the zip. Filled in by the next sync.
ALTER TABLE "Appointment" ADD COLUMN "lat" DOUBLE PRECISION,
ADD COLUMN "lng" DOUBLE PRECISION;
