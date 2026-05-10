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
