CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS ticketing;

CREATE TABLE IF NOT EXISTS ticketing.onchain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_hash TEXT NOT NULL,
  ledger INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  ticket_root_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onchain_events_idempotency
  ON ticketing.onchain_events (
    tx_hash,
    ledger,
    contract_address,
    event_name,
    ticket_root_id,
    version
  );

CREATE INDEX IF NOT EXISTS idx_onchain_events_ticket
  ON ticketing.onchain_events (
    contract_address,
    event_name,
    ticket_root_id,
    version
  );

CREATE INDEX IF NOT EXISTS idx_onchain_events_tx_hash
  ON ticketing.onchain_events (tx_hash);
