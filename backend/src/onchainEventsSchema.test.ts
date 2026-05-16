import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../prisma/migrations/202605100001_add_onchain_events/migration.sql'),
  'utf8',
);

test('onchain_events keeps the required event-ledger fields in Prisma schema', () => {
  const requiredFields = [
    'tx_hash',
    'ledger',
    'contract_address',
    'event_name',
    'ticket_root_id',
    'version',
    'payload',
    'processed_at',
    'status',
  ];

  for (const field of requiredFields) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }

  assert.match(
    schema,
    /@@unique\(\[tx_hash,\s*ledger,\s*contract_address,\s*event_name,\s*ticket_root_id,\s*version\]/,
  );
});

test('onchain_events migration is idempotent and creates the unique replay guard', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ticketing\.onchain_events/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_onchain_events_idempotency/);

  for (const column of ['tx_hash', 'ledger', 'contract_address', 'event_name', 'ticket_root_id', 'version']) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
});
