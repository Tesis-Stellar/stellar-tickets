import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../prisma/migrations/202605110005_restrict_tokenized_ticket_cascades/migration.sql'),
  'utf8',
);

test('issued tickets are not deleted by order item cascades', () => {
  assert.match(
    schema,
    /order_items\s+order_items\?\s+@relation\(fields:\s*\[order_item_id\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict/,
  );
  assert.match(migration, /CONSTRAINT "fk_tickets_order_item"[\s\S]*ON DELETE RESTRICT/);
});

test('orders with order items are protected from destructive deletion', () => {
  assert.match(
    schema,
    /orders\s+orders\s+@relation\(fields:\s*\[order_id\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict/,
  );
  assert.match(migration, /CONSTRAINT "fk_order_items_order"[\s\S]*ON DELETE RESTRICT/);
});
