import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveChainEventId } from './secureTicketPolicy';

test('derives stable u32 event ids from database event ids', () => {
  const eventId = '0230a44b-8739-4819-a5e4-bd1b377fc3a0';
  assert.equal(deriveChainEventId(eventId), deriveChainEventId(eventId));
  assert.ok(deriveChainEventId(eventId) > 0);
  assert.ok(deriveChainEventId(eventId) <= 0xffffffff);
});

test('derives different event ids for different events', () => {
  const first = deriveChainEventId('event-a');
  const second = deriveChainEventId('event-b');
  assert.notEqual(first, second);
});

test('rejects empty event ids', () => {
  assert.throws(() => deriveChainEventId(''), /eventId es requerido/);
});
