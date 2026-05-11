CREATE TABLE IF NOT EXISTS ticketing.checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  verifier_user_id UUID NOT NULL,
  ticket_id UUID,
  result TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'db',
  reason TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_checkins PRIMARY KEY (id),
  CONSTRAINT fk_checkins_verifier_user FOREIGN KEY (verifier_user_id)
    REFERENCES ticketing.users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_checkins_ticket FOREIGN KEY (ticket_id)
    REFERENCES ticketing.tickets(id) ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_checkins_verifier_created_at
  ON ticketing.checkins(verifier_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkins_ticket_created_at
  ON ticketing.checkins(ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkins_result_created_at
  ON ticketing.checkins(result, created_at DESC);
