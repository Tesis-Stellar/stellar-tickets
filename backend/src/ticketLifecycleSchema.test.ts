import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../prisma/migrations/202605110004_add_ticket_lifecycle_reason/migration.sql'),
  'utf8',
);

test('tickets expose an explicit lifecycle reason enum', () => {
  assert.match(schema, /lifecycle_reason\s+ticket_lifecycle_reason\?/);
  for (const reason of [
    'LISTED_FOR_RESALE',
    'LISTING_CANCELLED',
    'RESOLD_PREVIOUS_VERSION',
    'PRIMARY_P2P_REPLACED',
    'REDEEMED_DB_SCAN',
    'REDEEMED_ONCHAIN',
    'INVALIDATED_ONCHAIN',
    'LEGACY_USED',
    'LEGACY_CANCELLED',
    'REFUNDED_PAYMENT',
  ]) {
    assert.match(schema, new RegExp(`\\b${reason}\\b`));
  }
});

test('ticket lifecycle migration backfills old inactive tickets', () => {
  assert.match(migration, /CREATE TYPE "ticketing"\."ticket_lifecycle_reason"/);
  assert.match(migration, /ADD COLUMN "lifecycle_reason"/);
  assert.match(migration, /WHEN "status" = 'USED' THEN 'LEGACY_USED'/);
  assert.match(migration, /WHEN "status" = 'CANCELLED' AND "resale_price" IS NOT NULL THEN 'RESOLD_PREVIOUS_VERSION'/);
  assert.match(migration, /CREATE INDEX "idx_tickets_lifecycle_reason"/);
});
