import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertActivePreviousVersion,
  buildTicketVersionIdentity,
  resolveResaleVersions,
} from './indexerResalePolicy';

test('resolves resale versions from boleto_revendido payload', () => {
  assert.deepEqual(resolveResaleVersions({ version_anterior: 3, version_nueva: 4 }, -1), {
    previousVersion: 3,
    newVersion: 4,
  });
});

test('falls back to new version minus one when previous version is missing', () => {
  assert.deepEqual(resolveResaleVersions({ version_nueva: 2 }, -1), {
    previousVersion: 1,
    newVersion: 2,
  });
});

test('builds exact ticket version identity for indexer updates', () => {
  assert.deepEqual(buildTicketVersionIdentity('C_CONTRACT', 42, 7), {
    contract_address: 'C_CONTRACT',
    ticket_root_id: 42,
    version: 7,
  });
});

test('requires the exact previous version to be active before projecting resale', () => {
  assert.doesNotThrow(() => assertActivePreviousVersion({ order_item_id: 'order-item-1', status: 'ACTIVE' }, 42, 1));
  assert.throws(
    () => assertActivePreviousVersion({ order_item_id: 'order-item-1', status: 'CANCELLED' }, 42, 1),
    /version anterior ACTIVE/,
  );
  assert.throws(
    () => assertActivePreviousVersion(null, 42, 1),
    /version anterior ACTIVE/,
  );
});
