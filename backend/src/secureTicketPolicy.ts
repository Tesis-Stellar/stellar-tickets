import { createHash } from 'crypto';

const MAX_U32 = 0xffffffff;

export function deriveChainEventId(eventId: string): number {
  const normalized = String(eventId ?? '').trim();
  if (!normalized) {
    throw new Error('eventId es requerido para derivar id_evento');
  }

  const digest = createHash('sha256').update(normalized).digest();
  const value = digest.readUInt32BE(0);

  // Reserve 0 as an invalid/sentinel value and keep the output inside Soroban u32.
  return value === 0 ? MAX_U32 : value;
}

export function parseSorobanU32ReturnValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= MAX_U32 ? value : null;
  }

  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(MAX_U32) ? Number(value) : null;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return parseSorobanU32ReturnValue(BigInt(value));
  }

  if (Array.isArray(value) && value.length === 1) {
    return parseSorobanU32ReturnValue(value[0]);
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    value?: unknown;
    u32?: unknown;
    ok?: unknown;
    _value?: unknown;
    values?: unknown;
  };

  if (typeof candidate.u32 === 'function') {
    const parsed = parseSorobanU32ReturnValue(candidate.u32());
    if (parsed !== null) return parsed;
  }

  if (typeof candidate.value === 'function') {
    const parsed = parseSorobanU32ReturnValue(candidate.value());
    if (parsed !== null) return parsed;
  }

  if ('ok' in candidate) {
    const parsed = parseSorobanU32ReturnValue(candidate.ok);
    if (parsed !== null) return parsed;
  }

  if ('value' in candidate && typeof candidate.value !== 'function') {
    const parsed = parseSorobanU32ReturnValue(candidate.value);
    if (parsed !== null) return parsed;
  }

  if ('_value' in candidate) {
    const parsed = parseSorobanU32ReturnValue(candidate._value);
    if (parsed !== null) return parsed;
  }

  if ('values' in candidate) {
    const parsed = parseSorobanU32ReturnValue(candidate.values);
    if (parsed !== null) return parsed;
  }

  return null;
}
