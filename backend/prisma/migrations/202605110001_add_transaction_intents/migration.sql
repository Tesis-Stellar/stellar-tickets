CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS ticketing;

CREATE TABLE IF NOT EXISTS ticketing.transaction_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  wallet_address TEXT NOT NULL,
  operation TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  ticket_root_id INTEGER NOT NULL,
  expected_version INTEGER,
  expected_price BIGINT,
  xdr_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_transaction_intents_user
    FOREIGN KEY (user_id)
    REFERENCES ticketing.users(id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_intents_xdr_hash
  ON ticketing.transaction_intents (xdr_hash);

CREATE INDEX IF NOT EXISTS idx_transaction_intents_user_status
  ON ticketing.transaction_intents (user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_transaction_intents_ticket_operation
  ON ticketing.transaction_intents (contract_address, ticket_root_id, operation);
