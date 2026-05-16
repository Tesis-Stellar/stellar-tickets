-- DBI-06: make ticket lifecycle transitions explicit instead of inferring
-- business meaning from status plus incidental fields.

CREATE TYPE "ticketing"."ticket_lifecycle_reason" AS ENUM (
  'LISTED_FOR_RESALE',
  'LISTING_CANCELLED',
  'RESOLD_PREVIOUS_VERSION',
  'PRIMARY_P2P_REPLACED',
  'REDEEMED_DB_SCAN',
  'REDEEMED_ONCHAIN',
  'INVALIDATED_ONCHAIN',
  'LEGACY_USED',
  'LEGACY_CANCELLED',
  'REFUNDED_PAYMENT'
);

ALTER TABLE "ticketing"."tickets"
  ADD COLUMN "lifecycle_reason" "ticketing"."ticket_lifecycle_reason";

UPDATE "ticketing"."tickets"
SET "lifecycle_reason" = CASE
  WHEN "status" = 'USED' THEN 'LEGACY_USED'::"ticketing"."ticket_lifecycle_reason"
  WHEN "status" = 'CANCELLED' AND "resale_price" IS NOT NULL THEN 'RESOLD_PREVIOUS_VERSION'::"ticketing"."ticket_lifecycle_reason"
  WHEN "status" = 'CANCELLED' THEN 'LEGACY_CANCELLED'::"ticketing"."ticket_lifecycle_reason"
  WHEN "status" = 'REFUNDED' THEN 'REFUNDED_PAYMENT'::"ticketing"."ticket_lifecycle_reason"
  ELSE NULL
END
WHERE "status" IN ('USED', 'CANCELLED', 'REFUNDED');

CREATE INDEX "idx_tickets_lifecycle_reason" ON "ticketing"."tickets"("lifecycle_reason");
