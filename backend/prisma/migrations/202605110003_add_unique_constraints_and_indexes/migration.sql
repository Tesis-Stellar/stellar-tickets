-- DBI-05: enforce core uniqueness and add lookup indexes for marketplace/versioned tickets.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ticketing.users
    GROUP BY email
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create uq_users_email: duplicate user emails exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ticketing.events
    GROUP BY slug
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create uq_events_slug: duplicate event slugs exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX "uq_users_email" ON "ticketing"."users"("email");

CREATE UNIQUE INDEX "uq_events_slug" ON "ticketing"."events"("slug");

CREATE INDEX "idx_events_status_starts_at" ON "ticketing"."events"("status", "starts_at");

CREATE INDEX "idx_tickets_marketplace_active" ON "ticketing"."tickets"("contract_address", "is_for_sale", "status");

CREATE INDEX "idx_tickets_root_version_desc" ON "ticketing"."tickets"("contract_address", "ticket_root_id", "version" DESC);

