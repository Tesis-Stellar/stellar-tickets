import { createHash } from 'crypto';

const ORDER_NUMBER_HASH_LENGTH = 10;

export function normalizeIdempotencyKey(value: unknown): string | null {
  const key = String(value ?? '').trim();
  return key.length > 0 ? key.slice(0, 120) : null;
}

export function buildSimulatedOrderNumber(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, ORDER_NUMBER_HASH_LENGTH).toUpperCase();
  return `TT-SIM-${digest}`;
}
