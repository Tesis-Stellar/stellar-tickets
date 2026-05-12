import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveChainEventId, parseSorobanU32ReturnValue } from './secureTicketPolicy';

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

test('parses Soroban u32 return values without treating zero as missing', () => {
  assert.equal(parseSorobanU32ReturnValue(0), 0);
  assert.equal(parseSorobanU32ReturnValue(42n), 42);
  assert.equal(parseSorobanU32ReturnValue('7'), 7);
  assert.equal(parseSorobanU32ReturnValue({ ok: 3 }), 3);
  assert.equal(parseSorobanU32ReturnValue({ value: 9 }), 9);
  assert.equal(parseSorobanU32ReturnValue([11]), 11);
});

test('rejects invalid Soroban u32 return values', () => {
  assert.equal(parseSorobanU32ReturnValue(-1), null);
  assert.equal(parseSorobanU32ReturnValue(0xffffffff + 1), null);
  assert.equal(parseSorobanU32ReturnValue('not-a-number'), null);
  assert.equal(parseSorobanU32ReturnValue({ error: 1 }), null);
});
