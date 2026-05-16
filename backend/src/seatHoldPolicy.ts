export const DEFAULT_SEAT_HOLD_TTL_MS = 10 * 60 * 1000;

export type SeatInventoryStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';

export function buildSeatHoldExpiration(now = new Date(), ttlMs = DEFAULT_SEAT_HOLD_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs);
}

export function isSeatReservable(status: SeatInventoryStatus): boolean {
  return status === 'AVAILABLE';
}

export function isSeatHoldExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function evaluateAtomicSeatReservation(requestedSeats: number, reservedSeats: number): 'OK' | 'CONFLICT' {
  return requestedSeats === reservedSeats ? 'OK' : 'CONFLICT';
}

export function evaluateAtomicSeatSale(expectedSeats: number, soldSeats: number): 'OK' | 'CONFLICT' {
  return expectedSeats === soldSeats ? 'OK' : 'CONFLICT';
}
