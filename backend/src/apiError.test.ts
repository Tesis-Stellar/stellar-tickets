import assert from 'node:assert/strict';
import test from 'node:test';
import { apiErrorBody, codeForStatus } from './apiError';

test('builds standard API error bodies with code message and requestId', () => {
  const req = { requestId: 'req-1' } as any;
  assert.deepEqual(apiErrorBody(req, 'BAD_REQUEST', 'Payload invalido'), {
    code: 'BAD_REQUEST',
    message: 'Payload invalido',
    requestId: 'req-1',
  });
});

test('maps common HTTP statuses to stable error codes', () => {
  assert.equal(codeForStatus(400), 'BAD_REQUEST');
  assert.equal(codeForStatus(401), 'UNAUTHORIZED');
  assert.equal(codeForStatus(403), 'FORBIDDEN');
  assert.equal(codeForStatus(404), 'NOT_FOUND');
  assert.equal(codeForStatus(409), 'CONFLICT');
  assert.equal(codeForStatus(500), 'INTERNAL_ERROR');
});
