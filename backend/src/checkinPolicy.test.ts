import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCheckinPayloadSummary, summarizeScanRequest } from './checkinPolicy';

test('summarizes raw signed QR payloads without storing the full token', () => {
  assert.deepEqual(buildCheckinPayloadSummary({ qrToken: 'secret-token' }), {
    kind: 'signed_qr',
  });
});

test('summarizes legacy ticketId payloads when explicitly enabled', () => {
  assert.deepEqual(buildCheckinPayloadSummary({ ticketId: 'ticket-1' }), {
    kind: 'legacy_ticket_id',
    ticketId: 'ticket-1',
  });
});

test('summarizes parsed signed scan request with ticket identity claims', () => {
  assert.deepEqual(
    summarizeScanRequest({
      kind: 'contractTicket',
      contractAddress: 'CCONTRACT',
      ticketRootId: 1,
      version: 2,
      eventId: 'event-1',
      nonce: 'nonce-1',
      ownerWallet: 'GOWNER',
    }),
    {
      kind: 'signed_qr',
      contractAddress: 'CCONTRACT',
      ticketRootId: 1,
      version: 2,
      eventId: 'event-1',
      nonce: 'nonce-1',
      ownerWallet: 'GOWNER',
    },
  );
});
