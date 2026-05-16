import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(__dirname, '../prisma/migrations/202605110003_add_unique_constraints_and_indexes/migration.sql'),
  'utf8',
);

test('users.email and events.slug are enforced as unique in Prisma schema', () => {
  assert.match(schema, /email\s+String\s+@unique\(map:\s*"uq_users_email"\)\s+@db\.Citext/);
  assert.match(schema, /slug\s+String\s+@unique\(map:\s*"uq_events_slug"\)/);
});

test('DBI-05 migration creates unique email and slug constraints', () => {
  assert.match(migration, /CREATE UNIQUE INDEX "uq_users_email"/);
  assert.match(migration, /CREATE UNIQUE INDEX "uq_events_slug"/);
});

test('DBI-05 migration adds marketplace and version lookup indexes', () => {
  assert.match(migration, /CREATE INDEX "idx_events_status_starts_at"/);
  assert.match(migration, /CREATE INDEX "idx_tickets_marketplace_active"/);
  assert.match(migration, /CREATE INDEX "idx_tickets_root_version_desc"/);
});
