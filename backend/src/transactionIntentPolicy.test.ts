import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeTransactionIntentSubmit, buildTransactionIntentExpiry, type TransactionIntentSnapshot } from './transactionIntentPolicy';

const now = new Date('2026-05-11T00:00:00.000Z');

const baseIntent: TransactionIntentSnapshot = {
  id: 'intent-1',
  user_id: 'user-1',
  wallet_address: 'GWALLET',
  xdr_hash: 'hash-ok',
  status: 'PENDING',
  expires_at: buildTransactionIntentExpiry(now),
  submitted_at: null,
};

test('authorizes a pending intent for the same user wallet and XDR hash', () => {
  const result = authorizeTransactionIntentSubmit({
    intent: baseIntent,
    userId: 'user-1',
    walletAddress: 'GWALLET',
    signedXdrHash: 'hash-ok',
    now,
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects submit without a pending intent', () => {
  const result = authorizeTransactionIntentSubmit({
    intent: null,
    userId: 'user-1',
    walletAddress: 'GWALLET',
    signedXdrHash: 'hash-ok',
    now,
  });

  assert.deepEqual(result, { ok: false, status: 400, error: 'Intencion de transaccion no encontrada' });
});

test('rejects intents owned by another wallet', () => {
  const result = authorizeTransactionIntentSubmit({
    intent: baseIntent,
    userId: 'user-1',
    walletAddress: 'GOTHER',
    signedXdrHash: 'hash-ok',
    now,
  });

  assert.deepEqual(result, { ok: false, status: 403, error: 'La intencion no pertenece al usuario o wallet autenticada' });
});

test('rejects already submitted intents', () => {
  const result = authorizeTransactionIntentSubmit({
    intent: { ...baseIntent, status: 'SUBMITTED', submitted_at: now },
    userId: 'user-1',
    walletAddress: 'GWALLET',
    signedXdrHash: 'hash-ok',
    now,
  });

  assert.deepEqual(result, { ok: false, status: 409, error: 'Intencion de transaccion no pendiente: SUBMITTED' });
});

test('rejects expired intents and marks them as expirable', () => {
  const result = authorizeTransactionIntentSubmit({
    intent: { ...baseIntent, expires_at: new Date(now.getTime() - 1) },
    userId: 'user-1',
    walletAddress: 'GWALLET',
    signedXdrHash: 'hash-ok',
    now,
  });

  assert.deepEqual(result, { ok: false, status: 409, error: 'Intencion de transaccion expirada', markExpired: true });
});

test('rejects a signed XDR that does not match the generated intent hash', () => {
  const result = authorizeTransactionIntentSubmit({
    intent: baseIntent,
    userId: 'user-1',
    walletAddress: 'GWALLET',
    signedXdrHash: 'hash-tampered',
    now,
  });

  assert.deepEqual(result, { ok: false, status: 403, error: 'La transaccion firmada no coincide con la intencion autorizada' });
});
