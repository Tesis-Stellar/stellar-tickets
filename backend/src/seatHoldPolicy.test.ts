import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSeatHoldExpiration,
  evaluateAtomicSeatReservation,
  evaluateAtomicSeatSale,
  isSeatHoldExpired,
  isSeatReservable,
} from './seatHoldPolicy';

test('builds seat hold expiration from the reservation time', () => {
  const now = new Date('2026-05-11T00:00:00.000Z');

  assert.equal(buildSeatHoldExpiration(now, 60_000).toISOString(), '2026-05-11T00:01:00.000Z');
});

test('only AVAILABLE seats are reservable', () => {
  assert.equal(isSeatReservable('AVAILABLE'), true);
  assert.equal(isSeatReservable('HELD'), false);
  assert.equal(isSeatReservable('SOLD'), false);
  assert.equal(isSeatReservable('BLOCKED'), false);
});

test('detects expired seat holds inclusively at expiration instant', () => {
  const now = new Date('2026-05-11T00:10:00.000Z');

  assert.equal(isSeatHoldExpired(new Date('2026-05-11T00:09:59.999Z'), now), true);
  assert.equal(isSeatHoldExpired(new Date('2026-05-11T00:10:00.000Z'), now), true);
  assert.equal(isSeatHoldExpired(new Date('2026-05-11T00:10:00.001Z'), now), false);
});

test('atomic seat reservation conflicts when not every requested seat was updated', () => {
  assert.equal(evaluateAtomicSeatReservation(2, 2), 'OK');
  assert.equal(evaluateAtomicSeatReservation(2, 1), 'CONFLICT');
  assert.equal(evaluateAtomicSeatReservation(1, 0), 'CONFLICT');
});

test('atomic seat sale conflicts when not every held seat was sold', () => {
  assert.equal(evaluateAtomicSeatSale(2, 2), 'OK');
  assert.equal(evaluateAtomicSeatSale(2, 1), 'CONFLICT');
  assert.equal(evaluateAtomicSeatSale(1, 0), 'CONFLICT');
});
