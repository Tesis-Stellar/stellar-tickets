CREATE TYPE "ticketing"."resale_limit_type" AS ENUM ('FIXED_PRICE', 'PERCENTAGE');

CREATE TABLE "ticketing"."event_resale_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_type" "ticketing"."resale_limit_type" NOT NULL DEFAULT 'PERCENTAGE',
    "max_price_amount" DECIMAL(12,2),
    "max_price_percent" DECIMAL(5,2) DEFAULT 150,
    "resale_starts_at" TIMESTAMPTZ(6),
    "resale_ends_at" TIMESTAMPTZ(6),
    "block_hours_before_event" SMALLINT NOT NULL DEFAULT 6,
    "platform_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 3,
    "organizer_fee_percent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_event_resale_policies" PRIMARY KEY ("id"),
    CONSTRAINT "chk_event_resale_policies_fixed_limit"
        CHECK ("limit_type" <> 'FIXED_PRICE' OR ("max_price_amount" IS NOT NULL AND "max_price_amount" > 0)),
    CONSTRAINT "chk_event_resale_policies_percent_limit"
        CHECK ("limit_type" <> 'PERCENTAGE' OR ("max_price_percent" IS NOT NULL AND "max_price_percent" > 0)),
    CONSTRAINT "chk_event_resale_policies_window"
        CHECK ("resale_starts_at" IS NULL OR "resale_ends_at" IS NULL OR "resale_starts_at" < "resale_ends_at"),
    CONSTRAINT "chk_event_resale_policies_block_hours"
        CHECK ("block_hours_before_event" >= 0),
    CONSTRAINT "chk_event_resale_policies_fees"
        CHECK ("platform_fee_percent" >= 0 AND "organizer_fee_percent" >= 0 AND ("platform_fee_percent" + "organizer_fee_percent") <= 100)
);

CREATE UNIQUE INDEX "uq_event_resale_policies_event_id"
    ON "ticketing"."event_resale_policies"("event_id");

CREATE INDEX "idx_event_resale_policies_enabled"
    ON "ticketing"."event_resale_policies"("enabled");

ALTER TABLE "ticketing"."event_resale_policies"
    ADD CONSTRAINT "fk_event_resale_policies_event"
    FOREIGN KEY ("event_id") REFERENCES "ticketing"."events"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
