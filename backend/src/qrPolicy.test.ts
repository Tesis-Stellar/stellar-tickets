import assert from 'node:assert/strict';
import test from 'node:test';
import { signTicketQr, verifyTicketQr } from './qrPolicy';

const secret = 'qr-test-secret';
const now = new Date('2026-05-11T00:00:00.000Z');

test('signs and verifies a QR token with ticket identity claims', () => {
  const token = signTicketQr({
    secret,
    contractAddress: 'CCONTRACT',
    ticketRootId: 42,
    version: 3,
    eventId: 'event-1',
    ownerWallet: 'GOWNER',
    nonce: 'nonce-1',
    now,
  });

  const result = verifyTicketQr({ token, secret, now });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.claims.contractAddress, 'CCONTRACT');
    assert.equal(result.claims.ticketRootId, 42);
    assert.equal(result.claims.version, 3);
    assert.equal(result.claims.eventId, 'event-1');
    assert.equal(result.claims.ownerWallet, 'GOWNER');
    assert.equal(result.claims.nonce, 'nonce-1');
  }
});

test('rejects QR tokens with an altered payload', () => {
  const token = signTicketQr({
    secret,
    contractAddress: 'CCONTRACT',
    ticketRootId: 42,
    version: 3,
    eventId: 'event-1',
    nonce: 'nonce-1',
    now,
  });
  const [header, payload, signature] = token.split('.');
  const alteredPayload = Buffer.from(JSON.stringify({
    typ: 'secure-ticket.qr.v1',
    contractAddress: 'CCONTRACT',
    ticketRootId: 99,
    version: 3,
    eventId: 'event-1',
    exp: Math.floor(now.getTime() / 1000) + 60,
    nonce: 'nonce-1',
  })).toString('base64url');

  const result = verifyTicketQr({ token: `${header}.${alteredPayload}.${signature}`, secret, now });
  assert.deepEqual(result, { ok: false, status: 400, error: 'Firma de QR invalida' });
  assert.ok(payload);
});

test('rejects expired QR tokens', () => {
  const token = signTicketQr({
    secret,
    contractAddress: 'CCONTRACT',
    ticketRootId: 42,
    version: 3,
    eventId: 'event-1',
    nonce: 'nonce-1',
    now,
    ttlSeconds: 1,
  });

  const result = verifyTicketQr({ token, secret, now: new Date(now.getTime() + 2000) });
  assert.deepEqual(result, { ok: false, status: 409, error: 'QR expirado' });
});

test('rejects tokens with missing ticket claims', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ typ: 'secure-ticket.qr.v1' })).toString('base64url');

  const result = verifyTicketQr({ token: `${header}.${payload}.bad-signature`, secret, now });
  assert.deepEqual(result, { ok: false, status: 400, error: 'Firma de QR invalida' });
});
