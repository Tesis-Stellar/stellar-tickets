import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimulatedOrderNumber, normalizeIdempotencyKey } from './checkoutPolicy';

test('normalizes idempotency keys from body or headers', () => {
  assert.equal(normalizeIdempotencyKey('  checkout:cart-1  '), 'checkout:cart-1');
  assert.equal(normalizeIdempotencyKey(''), null);
  assert.equal(normalizeIdempotencyKey(null), null);
});

test('builds deterministic simulated order numbers for the same key', () => {
  assert.equal(
    buildSimulatedOrderNumber('checkout:user-1:cart-1'),
    buildSimulatedOrderNumber('checkout:user-1:cart-1'),
  );
  assert.notEqual(
    buildSimulatedOrderNumber('checkout:user-1:cart-1'),
    buildSimulatedOrderNumber('checkout:user-1:cart-2'),
  );
});
