-- DBI-08: protect issued/tokenized ticket history from destructive cascades.

ALTER TABLE "ticketing"."tickets"
  DROP CONSTRAINT "fk_tickets_order_item";

ALTER TABLE "ticketing"."tickets"
  ADD CONSTRAINT "fk_tickets_order_item"
  FOREIGN KEY ("order_item_id")
  REFERENCES "ticketing"."order_items"("id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

ALTER TABLE "ticketing"."order_items"
  DROP CONSTRAINT "fk_order_items_order";

ALTER TABLE "ticketing"."order_items"
  ADD CONSTRAINT "fk_order_items_order"
  FOREIGN KEY ("order_id")
  REFERENCES "ticketing"."orders"("id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

