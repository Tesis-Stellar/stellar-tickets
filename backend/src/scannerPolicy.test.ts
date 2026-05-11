import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeScannerRole, evaluateScanTicket, parseScanRequest } from './scannerPolicy';
import { signTicketQr } from './qrPolicy';

test('authorizes ADMIN and STAFF but rejects regular customers', () => {
  assert.equal(authorizeScannerRole('ADMIN'), null);
  assert.equal(authorizeScannerRole('STAFF'), null);
  assert.deepEqual(authorizeScannerRole('CUSTOMER'), {
    ok: false,
    status: 403,
    error: 'Acceso denegado',
  });
});

test('rejects invalid scan payloads', () => {
  assert.deepEqual(parseScanRequest({}), {
    ok: false,
    status: 400,
    error: 'Se requiere qrToken firmado',
  });

  assert.deepEqual(parseScanRequest({ contractAddress: 'CABC', ticketRootId: 'abc' }), {
    ok: false,
    status: 400,
    error: 'QR firmado requerido',
  });
});

test('rejects legacy ticketId scans unless explicitly enabled', () => {
  assert.deepEqual(parseScanRequest({ ticketId: 'ticket-1' }), {
    ok: false,
    status: 400,
    error: 'QR firmado requerido; ticketId legacy deshabilitado',
  });

  assert.deepEqual(parseScanRequest({ ticketId: 'ticket-1' }, { allowLegacyTicketId: true }), {
    kind: 'ticketId',
    ticketId: 'ticket-1',
  });
});

test('accepts signed QR tokens and extracts ticket identity', () => {
  const token = signTicketQr({
    secret: 'scanner-secret',
    contractAddress: 'CABC',
    ticketRootId: 123,
    version: 2,
    eventId: 'event-1',
    nonce: 'nonce-1',
    now: new Date('2026-05-11T00:00:00.000Z'),
  });

  assert.deepEqual(parseScanRequest({ qrToken: token }, { qrSecret: 'scanner-secret' }), {
    kind: 'contractTicket',
    contractAddress: 'CABC',
    ticketRootId: 123,
    version: 2,
    eventId: 'event-1',
    nonce: 'nonce-1',
    exp: 1778544000,
  });
});

test('rejects unsigned or altered QR tokens', () => {
  assert.deepEqual(parseScanRequest({ qrToken: 'not-a-token' }, { qrSecret: 'scanner-secret' }), {
    ok: false,
    status: 400,
    error: 'QR firmado invalido',
  });
});

test('accepts a valid active ticket for redemption', () => {
  assert.deepEqual(evaluateScanTicket({ id: 'ticket-1', status: 'ACTIVE', version: 2 }, 2), {
    ok: true,
    ticketId: 'ticket-1',
  });
});

test('rejects duplicate scans for already used tickets with 409', () => {
  assert.deepEqual(evaluateScanTicket({ id: 'ticket-1', status: 'USED', version: 2 }, 2), {
    ok: false,
    status: 409,
    error: 'Boleto ya no esta activo: USED',
  });
});

test('rejects stale QR versions after resale with 409', () => {
  assert.deepEqual(evaluateScanTicket({ id: 'ticket-2', status: 'ACTIVE', version: 3 }, 2), {
    ok: false,
    status: 409,
    error: 'QR vencido: este boleto fue revendido. El nuevo dueño tiene el QR válido.',
  });
});
