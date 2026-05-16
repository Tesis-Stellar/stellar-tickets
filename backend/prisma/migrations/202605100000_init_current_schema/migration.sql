-- Extensions required by Prisma schema native types/defaults.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ticketing";

-- CreateEnum
CREATE TYPE "ticketing"."document_type" AS ENUM ('CC', 'CE', 'TI', 'PP');

-- CreateEnum
CREATE TYPE "ticketing"."event_status" AS ENUM ('DRAFT', 'PUBLISHED', 'SOLD_OUT', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ticketing"."user_role" AS ENUM ('CUSTOMER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "ticketing"."cart_status" AS ENUM ('ACTIVE', 'EXPIRED', 'ABANDONED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ticketing"."order_status" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ticketing"."payment_method" AS ENUM ('CARD', 'PSE', 'CASHPOINT');

-- CreateEnum
CREATE TYPE "ticketing"."payment_status" AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ticketing"."seat_hold_status" AS ENUM ('ACTIVE', 'EXPIRED', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "ticketing"."seat_inventory_status" AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ticketing"."ticket_status" AS ENUM ('ACTIVE', 'USED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ticketing"."venue_type" AS ENUM ('ARENA', 'STADIUM', 'THEATER', 'CLUB', 'COLISEUM', 'CONVENTION_CENTER');

-- CreateTable
CREATE TABLE "ticketing"."cities" (
    "id" BIGSERIAL NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'CO',
    "department_name" CITEXT NOT NULL,
    "city_name" CITEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_cities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."event_categories" (
    "id" SMALLSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_event_categories" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."event_ticket_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "venue_section_id" UUID,
    "ticket_type_name" TEXT NOT NULL,
    "description" TEXT,
    "price_amount" DECIMAL(12,2) NOT NULL,
    "service_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_per_order" SMALLINT NOT NULL DEFAULT 6,
    "inventory_quantity" INTEGER,
    "sales_start_at" TIMESTAMPTZ(6),
    "sales_end_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_event_ticket_types" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_address" TEXT,
    "nft_contract_address" TEXT,
    "organizer_id" UUID NOT NULL,
    "category_id" SMALLINT NOT NULL,
    "venue_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "sales_start_at" TIMESTAMPTZ(6),
    "sales_end_at" TIMESTAMPTZ(6),
    "has_assigned_seating" BOOLEAN NOT NULL DEFAULT false,
    "max_tickets_per_user" SMALLINT NOT NULL DEFAULT 6,
    "status" "ticketing"."event_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."organizers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legal_name" TEXT NOT NULL,
    "tax_identifier" TEXT,
    "support_email" CITEXT,
    "support_phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_organizers" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."venues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "city_id" BIGINT NOT NULL,
    "address_line" TEXT NOT NULL,
    "venue_type" "ticketing"."venue_type" NOT NULL,
    "time_zone" TEXT NOT NULL DEFAULT 'America/Bogota',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_venues" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "wallet_address" TEXT,
    "document_type" "ticketing"."document_type" NOT NULL,
    "document_number" TEXT NOT NULL,
    "phone" TEXT,
    "role" "ticketing"."user_role" NOT NULL DEFAULT 'CUSTOMER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_users" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_address" TEXT,
    "order_item_id" UUID,
    "owner_user_id" UUID,
    "owner_wallet" TEXT,
    "ticket_code" TEXT,
    "ticket_root_id" INTEGER,
    "version" INTEGER,
    "is_for_sale" BOOLEAN NOT NULL DEFAULT false,
    "resale_price" BIGINT,
    "asset_code" TEXT,
    "nft_token_id" INTEGER,
    "qr_payload" TEXT,
    "status" "ticketing"."ticket_status" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_tickets" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."cart_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "event_ticket_type_id" UUID,
    "event_seat_inventory_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_amount" DECIMAL(12,2) NOT NULL,
    "service_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_total_amount" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_cart_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."carts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "status" "ticketing"."cart_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_carts" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."event_seat_inventory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "event_ticket_type_id" UUID NOT NULL,
    "status" "ticketing"."seat_inventory_status" NOT NULL DEFAULT 'AVAILABLE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_event_seat_inventory" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "event_ticket_type_id" UUID,
    "event_seat_inventory_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_amount" DECIMAL(12,2) NOT NULL,
    "service_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_total_amount" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_order_items" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "status" "ticketing"."order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "subtotal_amount" DECIMAL(12,2) NOT NULL,
    "service_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "buyer_email" CITEXT NOT NULL,
    "buyer_phone" TEXT,
    "buyer_document_type" "ticketing"."document_type" NOT NULL,
    "buyer_document_number" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_orders" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "payment_method" "ticketing"."payment_method" NOT NULL,
    "status" "ticketing"."payment_status" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'COP',
    "provider_reference" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_payments" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."seat_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cart_id" UUID NOT NULL,
    "event_seat_inventory_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "ticketing"."seat_hold_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_seat_holds" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."seats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venue_section_id" UUID NOT NULL,
    "row_label" TEXT,
    "seat_number" INTEGER,
    "seat_label" TEXT NOT NULL,
    "is_accessible" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_seats" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."venue_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venue_id" UUID NOT NULL,
    "section_name" TEXT NOT NULL,
    "section_code" TEXT NOT NULL,
    "has_numbered_seats" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_venue_sections" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."indexer_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_ledger" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indexer_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticketing"."onchain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tx_hash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "contract_address" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "ticket_root_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_onchain_events" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_cities_country_department_city" ON "ticketing"."cities"("country_code", "department_name", "city_name");

-- CreateIndex
CREATE UNIQUE INDEX "uq_event_categories_code" ON "ticketing"."event_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_event_categories_display_name" ON "ticketing"."event_categories"("display_name");

-- CreateIndex
CREATE INDEX "idx_event_ticket_types_event_id" ON "ticketing"."event_ticket_types"("event_id");

-- CreateIndex
CREATE INDEX "idx_event_ticket_types_section_id" ON "ticketing"."event_ticket_types"("venue_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_event_ticket_types_event_name" ON "ticketing"."event_ticket_types"("event_id", "ticket_type_name");

-- CreateIndex
CREATE UNIQUE INDEX "events_contract_address_key" ON "ticketing"."events"("contract_address");

-- CreateIndex
CREATE UNIQUE INDEX "events_nft_contract_address_key" ON "ticketing"."events"("nft_contract_address");

-- CreateIndex
CREATE INDEX "idx_events_category_status_starts_at" ON "ticketing"."events"("category_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "idx_events_organizer_starts_at" ON "ticketing"."events"("organizer_id", "starts_at");

-- CreateIndex
CREATE INDEX "idx_events_venue_starts_at" ON "ticketing"."events"("venue_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_organizers_tax_identifier" ON "ticketing"."organizers"("tax_identifier");

-- CreateIndex
CREATE INDEX "idx_venues_city_id" ON "ticketing"."venues"("city_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "ticketing"."users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tickets_ticket_code" ON "ticketing"."tickets"("ticket_code");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_asset_code_key" ON "ticketing"."tickets"("asset_code");

-- CreateIndex
CREATE INDEX "idx_tickets_owner_status" ON "ticketing"."tickets"("owner_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_contract_address_ticket_root_id_version_key" ON "ticketing"."tickets"("contract_address", "ticket_root_id", "version");

-- CreateIndex
CREATE INDEX "idx_cart_items_cart_id" ON "ticketing"."cart_items"("cart_id");

-- CreateIndex
CREATE INDEX "idx_carts_user_status" ON "ticketing"."carts"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_event_seat_inventory_event_status" ON "ticketing"."event_seat_inventory"("event_id", "status");

-- CreateIndex
CREATE INDEX "idx_event_seat_inventory_ticket_type" ON "ticketing"."event_seat_inventory"("event_ticket_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_event_seat_inventory_event_seat" ON "ticketing"."event_seat_inventory"("event_id", "seat_id");

-- CreateIndex
CREATE INDEX "idx_order_items_order_id" ON "ticketing"."order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_orders_order_number" ON "ticketing"."orders"("order_number");

-- CreateIndex
CREATE INDEX "idx_orders_user_created_at" ON "ticketing"."orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_payments_order_created_at" ON "ticketing"."payments"("order_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_seat_holds_expires_at" ON "ticketing"."seat_holds"("expires_at");

-- CreateIndex
CREATE INDEX "idx_seats_section_id" ON "ticketing"."seats"("venue_section_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_seats_section_label" ON "ticketing"."seats"("venue_section_id", "seat_label");

-- CreateIndex
CREATE UNIQUE INDEX "uq_seats_section_row_number" ON "ticketing"."seats"("venue_section_id", "row_label", "seat_number");

-- CreateIndex
CREATE INDEX "idx_venue_sections_venue_id" ON "ticketing"."venue_sections"("venue_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_venue_sections_venue_code" ON "ticketing"."venue_sections"("venue_id", "section_code");

-- CreateIndex
CREATE UNIQUE INDEX "uq_venue_sections_venue_name" ON "ticketing"."venue_sections"("venue_id", "section_name");

-- CreateIndex
CREATE INDEX "idx_onchain_events_ticket" ON "ticketing"."onchain_events"("contract_address", "event_name", "ticket_root_id", "version");

-- CreateIndex
CREATE INDEX "idx_onchain_events_tx_hash" ON "ticketing"."onchain_events"("tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_onchain_events_idempotency" ON "ticketing"."onchain_events"("tx_hash", "ledger", "contract_address", "event_name", "ticket_root_id", "version");

-- AddForeignKey
ALTER TABLE "ticketing"."event_ticket_types" ADD CONSTRAINT "fk_event_ticket_types_event" FOREIGN KEY ("event_id") REFERENCES "ticketing"."events"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."event_ticket_types" ADD CONSTRAINT "fk_event_ticket_types_venue_section" FOREIGN KEY ("venue_section_id") REFERENCES "ticketing"."venue_sections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."events" ADD CONSTRAINT "fk_events_category" FOREIGN KEY ("category_id") REFERENCES "ticketing"."event_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."events" ADD CONSTRAINT "fk_events_organizer" FOREIGN KEY ("organizer_id") REFERENCES "ticketing"."organizers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."events" ADD CONSTRAINT "fk_events_venue" FOREIGN KEY ("venue_id") REFERENCES "ticketing"."venues"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."venues" ADD CONSTRAINT "fk_venues_city" FOREIGN KEY ("city_id") REFERENCES "ticketing"."cities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."tickets" ADD CONSTRAINT "fk_tickets_order_item" FOREIGN KEY ("order_item_id") REFERENCES "ticketing"."order_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."tickets" ADD CONSTRAINT "fk_tickets_owner_user" FOREIGN KEY ("owner_user_id") REFERENCES "ticketing"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."cart_items" ADD CONSTRAINT "fk_cart_items_cart" FOREIGN KEY ("cart_id") REFERENCES "ticketing"."carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."cart_items" ADD CONSTRAINT "fk_cart_items_event_seat_inventory" FOREIGN KEY ("event_seat_inventory_id") REFERENCES "ticketing"."event_seat_inventory"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."cart_items" ADD CONSTRAINT "fk_cart_items_ticket_type" FOREIGN KEY ("event_ticket_type_id") REFERENCES "ticketing"."event_ticket_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."carts" ADD CONSTRAINT "fk_carts_user" FOREIGN KEY ("user_id") REFERENCES "ticketing"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."event_seat_inventory" ADD CONSTRAINT "fk_event_seat_inventory_event" FOREIGN KEY ("event_id") REFERENCES "ticketing"."events"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."event_seat_inventory" ADD CONSTRAINT "fk_event_seat_inventory_seat" FOREIGN KEY ("seat_id") REFERENCES "ticketing"."seats"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."event_seat_inventory" ADD CONSTRAINT "fk_event_seat_inventory_ticket_type" FOREIGN KEY ("event_ticket_type_id") REFERENCES "ticketing"."event_ticket_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."order_items" ADD CONSTRAINT "fk_order_items_event_seat_inventory" FOREIGN KEY ("event_seat_inventory_id") REFERENCES "ticketing"."event_seat_inventory"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."order_items" ADD CONSTRAINT "fk_order_items_order" FOREIGN KEY ("order_id") REFERENCES "ticketing"."orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."order_items" ADD CONSTRAINT "fk_order_items_ticket_type" FOREIGN KEY ("event_ticket_type_id") REFERENCES "ticketing"."event_ticket_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id") REFERENCES "ticketing"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."payments" ADD CONSTRAINT "fk_payments_order" FOREIGN KEY ("order_id") REFERENCES "ticketing"."orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."seat_holds" ADD CONSTRAINT "fk_seat_holds_cart" FOREIGN KEY ("cart_id") REFERENCES "ticketing"."carts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."seat_holds" ADD CONSTRAINT "fk_seat_holds_event_seat_inventory" FOREIGN KEY ("event_seat_inventory_id") REFERENCES "ticketing"."event_seat_inventory"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."seats" ADD CONSTRAINT "fk_seats_venue_section" FOREIGN KEY ("venue_section_id") REFERENCES "ticketing"."venue_sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ticketing"."venue_sections" ADD CONSTRAINT "fk_venue_sections_venue" FOREIGN KEY ("venue_id") REFERENCES "ticketing"."venues"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
