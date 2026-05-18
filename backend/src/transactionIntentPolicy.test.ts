import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeTransactionIntentCurrentState,
  authorizeTransactionIntentSubmit,
  buildTransactionIntentExpiry,
  type TransactionIntentSnapshot,
  type TransactionIntentTicketSnapshot,
} from './transactionIntentPolicy';

const now = new Date('2026-05-11T00:00:00.000Z');

const baseIntent: TransactionIntentSnapshot = {
  id: 'intent-1',
  user_id: 'user-1',
  wallet_address: 'GWALLET',
  operation: 'comprar_boleto',
  contract_address: 'CCONTRACT',
  ticket_root_id: 10,
  expected_version: 2,
  expected_price: 1000n,
  xdr_hash: 'hash-ok',
  status: 'PENDING',
  expires_at: buildTransactionIntentExpiry(now),
  submitted_at: null,
};

const baseTicket: TransactionIntentTicketSnapshot = {
  contract_address: 'CCONTRACT',
  ticket_root_id: 10,
  version: 2,
  owner_wallet: 'GOWNER',
  status: 'ACTIVE',
  is_for_sale: true,
  resale_price: 1000n,
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

test('authorizes buy intent only when current version price and sale status still match', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'comprar_boleto' },
    ticket: baseTicket,
    walletAddress: 'GBUYER',
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects buy intent when resale price changed after XDR build', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'comprar_boleto', expected_price: 1000n },
    ticket: { ...baseTicket, resale_price: 2000n },
    walletAddress: 'GBUYER',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    error: 'El precio actual del ticket no coincide con la intencion firmada',
  });
});

test('rejects intents when current ticket version changed after XDR build', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, expected_version: 2 },
    ticket: { ...baseTicket, version: 3 },
    walletAddress: 'GBUYER',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    error: 'La version actual del ticket no coincide con la intencion firmada',
  });
});

test('authorizes list intent only while owner and unlisted state still match', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'listar_boleto', expected_price: 3000n },
    ticket: { ...baseTicket, owner_wallet: 'GOWNER', is_for_sale: false, resale_price: null },
    walletAddress: 'GOWNER',
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects list intent when ticket was listed before submit', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'listar_boleto' },
    ticket: { ...baseTicket, owner_wallet: 'GOWNER', is_for_sale: true },
    walletAddress: 'GOWNER',
  });

  assert.deepEqual(result, { ok: false, status: 409, error: 'Ticket ya esta en venta' });
});

test('API-RESALE-CANCEL-01 authorizes cancellation only for the owner while the listing still exists', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'cancelar_venta', expected_price: null },
    ticket: { ...baseTicket, owner_wallet: 'GOWNER', is_for_sale: true },
    walletAddress: 'GOWNER',
  });

  assert.deepEqual(result, { ok: true });

  const intruder = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'cancelar_venta', expected_price: null },
    ticket: { ...baseTicket, owner_wallet: 'GOWNER', is_for_sale: true },
    walletAddress: 'GINTRUDER',
  });
  assert.deepEqual(intruder, {
    ok: false,
    status: 403,
    error: 'La wallet ya no coincide con el propietario del ticket',
  });

  const cancelled = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'cancelar_venta' },
    ticket: { ...baseTicket, owner_wallet: 'GOWNER', is_for_sale: false },
    walletAddress: 'GOWNER',
  });
  assert.deepEqual(cancelled, { ok: false, status: 409, error: 'Ticket ya no esta en venta' });
});

test('rejects cancel listing intent when ticket is no longer for sale', () => {
  const result = authorizeTransactionIntentCurrentState({
    intent: { ...baseIntent, operation: 'cancelar_venta' },
    ticket: { ...baseTicket, owner_wallet: 'GOWNER', is_for_sale: false },
    walletAddress: 'GOWNER',
  });

  assert.deepEqual(result, { ok: false, status: 409, error: 'Ticket ya no esta en venta' });
});
