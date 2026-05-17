export const PQR_CLAIM_TYPES = [
  'TICKET_NOT_RECEIVED',
  'INVALID_QR',
  'DUPLICATE_OR_USED_TICKET',
  'FAILED_TRANSACTION',
  'INCORRECT_INFORMATION',
  'REFUND_OR_REVIEW',
  'OTHER',
] as const;

export const PQR_CLAIM_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_USER',
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type PqrClaimType = (typeof PQR_CLAIM_TYPES)[number];
export type PqrClaimStatus = (typeof PQR_CLAIM_STATUSES)[number];

export function isPqrClaimType(value: unknown): value is PqrClaimType {
  return typeof value === 'string' && (PQR_CLAIM_TYPES as readonly string[]).includes(value);
}

export function isPqrClaimStatus(value: unknown): value is PqrClaimStatus {
  return typeof value === 'string' && (PQR_CLAIM_STATUSES as readonly string[]).includes(value);
}

export function canUserAccessClaim(input: { role?: string | null; userId: string; claimUserId: string }) {
  return input.role === 'ADMIN' || input.role === 'STAFF' || input.userId === input.claimUserId;
}

export function isInternalClaimRole(role?: string | null) {
  return role === 'ADMIN' || role === 'STAFF';
}
