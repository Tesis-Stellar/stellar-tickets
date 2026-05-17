CREATE TYPE "ticketing"."pqr_claim_type" AS ENUM (
    'TICKET_NOT_RECEIVED',
    'INVALID_QR',
    'DUPLICATE_OR_USED_TICKET',
    'FAILED_TRANSACTION',
    'INCORRECT_INFORMATION',
    'REFUND_OR_REVIEW',
    'OTHER'
);

CREATE TYPE "ticketing"."pqr_claim_status" AS ENUM (
    'OPEN',
    'IN_REVIEW',
    'WAITING_USER',
    'RESOLVED',
    'REJECTED',
    'CANCELLED'
);

CREATE TABLE "ticketing"."pqr_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "ticket_id" UUID,
    "order_id" UUID,
    "event_id" UUID,
    "type" "ticketing"."pqr_claim_type" NOT NULL,
    "status" "ticketing"."pqr_claim_status" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "related_tx_hash" TEXT,
    "evidence" JSONB NOT NULL,
    "decision_reason" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pqr_claims" PRIMARY KEY ("id"),
    CONSTRAINT "chk_pqr_claims_subject_not_blank" CHECK (length(btrim("subject")) > 0),
    CONSTRAINT "chk_pqr_claims_description_not_blank" CHECK (length(btrim("description")) > 0)
);

CREATE TABLE "ticketing"."pqr_claim_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "claim_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "status_from" "ticketing"."pqr_claim_status",
    "status_to" "ticketing"."pqr_claim_status",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_pqr_claim_messages" PRIMARY KEY ("id"),
    CONSTRAINT "chk_pqr_claim_messages_message_not_blank" CHECK (length(btrim("message")) > 0)
);

CREATE INDEX "idx_pqr_claims_user_created_at"
    ON "ticketing"."pqr_claims"("user_id", "created_at" DESC);

CREATE INDEX "idx_pqr_claims_status_created_at"
    ON "ticketing"."pqr_claims"("status", "created_at" DESC);

CREATE INDEX "idx_pqr_claims_type_created_at"
    ON "ticketing"."pqr_claims"("type", "created_at" DESC);

CREATE INDEX "idx_pqr_claims_event_status"
    ON "ticketing"."pqr_claims"("event_id", "status");

CREATE INDEX "idx_pqr_claims_assignee_status"
    ON "ticketing"."pqr_claims"("assigned_to_user_id", "status");

CREATE INDEX "idx_pqr_claim_messages_claim_created_at"
    ON "ticketing"."pqr_claim_messages"("claim_id", "created_at");

ALTER TABLE "ticketing"."pqr_claims"
    ADD CONSTRAINT "fk_pqr_claims_user"
    FOREIGN KEY ("user_id") REFERENCES "ticketing"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."pqr_claims"
    ADD CONSTRAINT "fk_pqr_claims_assignee"
    FOREIGN KEY ("assigned_to_user_id") REFERENCES "ticketing"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."pqr_claims"
    ADD CONSTRAINT "fk_pqr_claims_ticket"
    FOREIGN KEY ("ticket_id") REFERENCES "ticketing"."tickets"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."pqr_claims"
    ADD CONSTRAINT "fk_pqr_claims_order"
    FOREIGN KEY ("order_id") REFERENCES "ticketing"."orders"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."pqr_claims"
    ADD CONSTRAINT "fk_pqr_claims_event"
    FOREIGN KEY ("event_id") REFERENCES "ticketing"."events"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."pqr_claim_messages"
    ADD CONSTRAINT "fk_pqr_claim_messages_claim"
    FOREIGN KEY ("claim_id") REFERENCES "ticketing"."pqr_claims"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."pqr_claim_messages"
    ADD CONSTRAINT "fk_pqr_claim_messages_author"
    FOREIGN KEY ("author_id") REFERENCES "ticketing"."users"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
