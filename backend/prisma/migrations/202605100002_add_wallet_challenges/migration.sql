CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS ticketing;

CREATE TABLE IF NOT EXISTS ticketing.wallet_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_wallet_challenges_user
    FOREIGN KEY (user_id)
    REFERENCES ticketing.users(id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_challenges_nonce
  ON ticketing.wallet_challenges (nonce);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_user_wallet
  ON ticketing.wallet_challenges (user_id, wallet_address, consumed_at);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expires_at
  ON ticketing.wallet_challenges (expires_at);
