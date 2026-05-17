import assert from 'node:assert/strict';
import test from 'node:test';
import { canUserAccessClaim, isInternalClaimRole, isPqrClaimStatus, isPqrClaimType } from './claimPolicy';

test('validates supported PQR claim types and statuses', () => {
  assert.equal(isPqrClaimType('INVALID_QR'), true);
  assert.equal(isPqrClaimType('NOT_A_TYPE'), false);
  assert.equal(isPqrClaimStatus('IN_REVIEW'), true);
  assert.equal(isPqrClaimStatus('CLOSED'), false);
});

test('allows users to access own claims and staff/admin to access all claims', () => {
  assert.equal(canUserAccessClaim({ role: 'CUSTOMER', userId: 'u1', claimUserId: 'u1' }), true);
  assert.equal(canUserAccessClaim({ role: 'CUSTOMER', userId: 'u1', claimUserId: 'u2' }), false);
  assert.equal(canUserAccessClaim({ role: 'STAFF', userId: 'u1', claimUserId: 'u2' }), true);
  assert.equal(canUserAccessClaim({ role: 'ADMIN', userId: 'u1', claimUserId: 'u2' }), true);
});

test('recognizes internal claim management roles', () => {
  assert.equal(isInternalClaimRole('ADMIN'), true);
  assert.equal(isInternalClaimRole('STAFF'), true);
  assert.equal(isInternalClaimRole('CUSTOMER'), false);
});
