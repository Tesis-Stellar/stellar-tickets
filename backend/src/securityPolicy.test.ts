import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRateLimit, isCorsOriginAllowed, isJwtSecretStrong, parseCorsOrigins } from './securityPolicy';

test('parses CORS origins from comma-separated env values', () => {
  assert.deepEqual(parseCorsOrigins('http://localhost:5173, https://secure-ticket.test'), [
    'http://localhost:5173',
    'https://secure-ticket.test',
  ]);
});

test('allows browser origins only when present in the allowlist', () => {
  const allowed = ['http://localhost:5173'];
  assert.equal(isCorsOriginAllowed(undefined, allowed), true);
  assert.equal(isCorsOriginAllowed('http://localhost:5173', allowed), true);
  assert.equal(isCorsOriginAllowed('https://evil.example', allowed), false);
});

test('rate limit allows requests until the bucket exceeds max', () => {
  const now = 1000;
  const first = evaluateRateLimit({ bucket: undefined, now, windowMs: 60000, max: 2 });
  assert.equal(first.allowed, true);
  const second = evaluateRateLimit({ bucket: first.bucket, now: now + 1, windowMs: 60000, max: 2 });
  assert.equal(second.allowed, true);
  const third = evaluateRateLimit({ bucket: second.bucket, now: now + 2, windowMs: 60000, max: 2 });
  assert.equal(third.allowed, false);
});

test('rate limit resets after the configured window', () => {
  const first = evaluateRateLimit({ bucket: { count: 5, resetAt: 1000 }, now: 1000, windowMs: 60000, max: 2 });
  assert.deepEqual(first, { allowed: true, bucket: { count: 1, resetAt: 61000 } });
});

test('JWT secret strength requires at least 32 characters', () => {
  assert.equal(isJwtSecretStrong('short'), false);
  assert.equal(isJwtSecretStrong('12345678901234567890123456789012'), true);
});
