import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCreatedTicketProjection,
  buildCursorUpdate,
  buildListingCancellationProjection,
  buildListingProjection,
  buildOnchainEventIdentity,
  buildRedemptionProjection,
  shouldSkipProcessedEvent,
} from './indexerEventPolicy';
import { buildTicketVersionIdentity, resolveResaleVersions } from './indexerResalePolicy';

test('projects boleto_creado into an ACTIVE version 0 ticket', () => {
  assert.deepEqual(buildCreatedTicketProjection({
    contractId: 'C_EVENT',
    rootId: 10,
    ownerWallet: 'GOWNER',
    ownerUserId: 'user-1',
  }), {
    contract_address: 'C_EVENT',
    ticket_root_id: 10,
    version: 0,
    owner_wallet: 'GOWNER',
    owner_user_id: 'user-1',
    is_for_sale: false,
    status: 'ACTIVE',
  });
});

test('projects boleto_listado for the exact listed version', () => {
  assert.deepEqual(buildListingProjection({
    contractId: 'C_EVENT',
    rootId: 10,
    version: 2,
    resalePrice: 25n,
  }), {
    where: {
      contract_address: 'C_EVENT',
      ticket_root_id: 10,
      status: 'ACTIVE',
      version: 2,
    },
    data: {
      is_for_sale: true,
      resale_price: 25n,
      lifecycle_reason: 'LISTED_FOR_RESALE',
    },
  });
});

test('projects venta_cancelada with an explicit listing cancellation reason', () => {
  assert.deepEqual(buildListingCancellationProjection({
    contractId: 'C_EVENT',
    rootId: 10,
    version: 2,
  }), {
    where: {
      contract_address: 'C_EVENT',
      ticket_root_id: 10,
      status: 'ACTIVE',
      version: 2,
    },
    data: {
      is_for_sale: false,
      resale_price: null,
      lifecycle_reason: 'LISTING_CANCELLED',
    },
  });
});

test('projects boleto_revendido using previous and new exact versions', () => {
  const { previousVersion, newVersion } = resolveResaleVersions({ version_anterior: 1, version_nueva: 2 }, -1);
  assert.deepEqual(buildTicketVersionIdentity('C_EVENT', 10, previousVersion), {
    contract_address: 'C_EVENT',
    ticket_root_id: 10,
    version: 1,
  });
  assert.deepEqual(buildTicketVersionIdentity('C_EVENT', 10, newVersion), {
    contract_address: 'C_EVENT',
    ticket_root_id: 10,
    version: 2,
  });
});

test('projects boleto_redimido as USED with used_at', () => {
  const usedAt = new Date('2026-05-10T12:00:00.000Z');
  assert.deepEqual(buildRedemptionProjection({ contractId: 'C_EVENT', rootId: 10, usedAt }), {
    where: {
      contract_address: 'C_EVENT',
      ticket_root_id: 10,
      status: 'ACTIVE',
    },
    data: {
      status: 'USED',
      used_at: usedAt,
      is_for_sale: false,
      lifecycle_reason: 'REDEEMED_ONCHAIN',
    },
  });
});

test('builds replay identity from a simulated on-chain event', () => {
  assert.deepEqual(buildOnchainEventIdentity({
    evt: { txHash: 'tx-1', ledger: 123 },
    eventName: 'boleto_revendido',
    contractId: 'C_EVENT',
    topics: ['boleto_revendido', 10, 99],
    data: { version_nueva: 2 },
    fallbackLedger: 100,
  }), {
    tx_hash: 'tx-1',
    ledger: 123,
    contract_address: 'C_EVENT',
    event_name: 'boleto_revendido',
    ticket_root_id: 10,
    version: 2,
  });
  assert.equal(shouldSkipProcessedEvent('PROCESSED'), true);
  assert.equal(shouldSkipProcessedEvent('FAILED'), false);
});

test('updates cursor to the ledger after the processed range', () => {
  assert.deepEqual(buildCursorUpdate(200), {
    where: { id: 1 },
    data: { last_ledger: 201 },
  });
});
