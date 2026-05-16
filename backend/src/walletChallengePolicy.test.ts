import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import {
  buildWalletChallengeMessage,
  createWalletChallenge,
  isValidStellarPublicKey,
  verifyWalletChallengeSignature,
} from './walletChallengePolicy';

const keypair = Keypair.random();
const walletAddress = keypair.publicKey();
const issuedAt = new Date('2026-05-10T12:00:00.000Z');
const expiresAt = new Date('2026-05-10T12:05:00.000Z');
const message = buildWalletChallengeMessage({
  userId: 'user-1',
  walletAddress,
  nonce: 'nonce-1',
  issuedAt,
  expiresAt,
});

function sign(messageToSign: string, signer = keypair): string {
  return signer.sign(Buffer.from(messageToSign, 'utf8')).toString('base64');
}

function signFreighterMessage(messageToSign: string, signer = keypair): string {
  const hash = createHash('sha256')
    .update(`Stellar Signed Message:\n${messageToSign}`, 'utf8')
    .digest();
  return signer.sign(hash).toString('base64');
}

test('accepts a valid Freighter signMessage signature for the requested wallet', () => {
  const result = verifyWalletChallengeSignature({
    walletAddress,
    message,
    signature: signFreighterMessage(message),
    expiresAt,
    now: issuedAt,
  });

  assert.deepEqual(result, { ok: true });
});

test('accepts the legacy raw challenge signature used by older manual tests', () => {
  const result = verifyWalletChallengeSignature({
    walletAddress,
    message,
    signature: sign(message),
    expiresAt,
    now: issuedAt,
  });

  assert.deepEqual(result, { ok: true });
});

test('rejects a signature produced by a different wallet', () => {
  const result = verifyWalletChallengeSignature({
    walletAddress,
    message,
    signature: sign(message, Keypair.random()),
    expiresAt,
    now: issuedAt,
  });

  assert.deepEqual(result, { ok: false, status: 403, error: 'Firma de wallet invalida' });
});

test('rejects malformed signatures without throwing', () => {
  const result = verifyWalletChallengeSignature({
    walletAddress,
    message,
    signature: 'firma_invalida',
    expiresAt,
    now: issuedAt,
  });

  assert.deepEqual(result, { ok: false, status: 400, error: 'Firma invalida' });
});

test('rejects an expired wallet challenge', () => {
  const result = verifyWalletChallengeSignature({
    walletAddress,
    message,
    signature: sign(message),
    expiresAt,
    now: new Date('2026-05-10T12:05:01.000Z'),
  });

  assert.deepEqual(result, { ok: false, status: 410, error: 'Challenge expirado' });
});

test('rejects malformed Stellar public keys before issuing a challenge', () => {
  assert.equal(isValidStellarPublicKey('not-a-stellar-public-key'), false);

  const result = createWalletChallenge({
    userId: 'user-1',
    walletAddress: 'not-a-stellar-public-key',
    now: issuedAt,
  });

  assert.deepEqual(result, { ok: false, status: 400, error: 'walletAddress Stellar invalida' });
});
