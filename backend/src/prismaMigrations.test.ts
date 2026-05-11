import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migrationsDir = join(__dirname, '../prisma/migrations');
const initMigration = readFileSync(
  join(migrationsDir, '202605100000_init_current_schema/migration.sql'),
  'utf8',
);
const allMigrations = readdirSync(migrationsDir)
  .filter((entry) => entry !== 'migration_lock.toml')
  .sort()
  .map((entry) => readFileSync(join(migrationsDir, entry, 'migration.sql'), 'utf8'))
  .join('\n');
const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

test('Prisma migrations are configured for PostgreSQL deploys', () => {
  const lockPath = join(migrationsDir, 'migration_lock.toml');
  assert.equal(existsSync(lockPath), true);
  assert.match(readFileSync(lockPath, 'utf8'), /provider = "postgresql"/);
});

test('versioned migrations recreate every ticketing table declared in schema.prisma', () => {
  const modelTableNames = Array.from(schema.matchAll(/^model\s+(\w+)\s+\{/gm)).map(([, model]) => model);

  assert.ok(modelTableNames.length > 0);
  for (const tableName of modelTableNames) {
    assert.match(
      allMigrations,
      new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?ticketing"?\\."?${tableName}"?`),
      `missing CREATE TABLE for ${tableName}`,
    );
  }
});

test('initial migration enables extensions required by current schema', () => {
  assert.match(initMigration, /CREATE EXTENSION IF NOT EXISTS citext/);
  assert.match(initMigration, /CREATE EXTENSION IF NOT EXISTS pgcrypto/);
});
