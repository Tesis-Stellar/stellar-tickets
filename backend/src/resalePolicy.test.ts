import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultResalePolicy, evaluateResalePolicy } from './resalePolicy';

const eventStartsAt = new Date('2026-06-01T20:00:00.000Z');
const now = new Date('2026-05-20T12:00:00.000Z');

test('allows resale when price and date are within the event policy', () => {
  const result = evaluateResalePolicy({
    policy: defaultResalePolicy(),
    originalPriceAmount: 100000,
    requestedPriceAmount: 120000,
    eventStartsAt,
    now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.maxPriceAmount, 150000);
  assert.equal(result.snapshot.sellerReceivesPercent, 92);
});

test('rejects resale when event policy disables resale', () => {
  const result = evaluateResalePolicy({
    policy: { ...defaultResalePolicy(), enabled: false },
    originalPriceAmount: 100000,
    requestedPriceAmount: 100000,
    eventStartsAt,
    now,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: 'La reventa no está habilitada para este evento',
    snapshot: result.snapshot,
  });
});

test('rejects resale above percentage maximum', () => {
  const result = evaluateResalePolicy({
    policy: { ...defaultResalePolicy(), maxPricePercent: 120 },
    originalPriceAmount: 100000,
    requestedPriceAmount: 130000,
    eventStartsAt,
    now,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.equal(result.error, 'El precio de reventa supera el máximo permitido para este evento');
    assert.equal(result.snapshot.maxPriceAmount, 120000);
  }
});

test('rejects resale above fixed maximum', () => {
  const result = evaluateResalePolicy({
    policy: { ...defaultResalePolicy(), limitType: 'FIXED_PRICE', maxPriceAmount: 95000 },
    originalPriceAmount: 100000,
    requestedPriceAmount: 100000,
    eventStartsAt,
    now,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.equal(result.snapshot.maxPriceAmount, 95000);
  }
});

test('rejects resale before the configured window starts', () => {
  const result = evaluateResalePolicy({
    policy: { ...defaultResalePolicy(), resaleStartsAt: new Date('2026-05-21T00:00:00.000Z') },
    originalPriceAmount: 100000,
    requestedPriceAmount: 100000,
    eventStartsAt,
    now,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.equal(result.error, 'La ventana de reventa aún no ha iniciado');
  }
});

test('rejects resale after the event block deadline', () => {
  const result = evaluateResalePolicy({
    policy: { ...defaultResalePolicy(), blockHoursBeforeEvent: 6 },
    originalPriceAmount: 100000,
    requestedPriceAmount: 100000,
    eventStartsAt,
    now: new Date('2026-06-01T15:00:00.000Z'),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.equal(result.error, 'La ventana de reventa ya finalizó para este evento');
    assert.equal(result.snapshot.resaleDeadline, '2026-06-01T14:00:00.000Z');
  }
});
