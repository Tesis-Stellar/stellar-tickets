import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeScannerRole, evaluateScanTicket, parseScanRequest } from './scannerPolicy';

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
    error: 'Se requiere ticketId o (contractAddress + ticketRootId)',
  });

  assert.deepEqual(parseScanRequest({ contractAddress: 'CABC', ticketRootId: 'abc' }), {
    ok: false,
    status: 400,
    error: 'Payload de QR invalido',
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
