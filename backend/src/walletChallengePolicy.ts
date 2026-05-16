import { createHash, randomBytes } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const FREIGHTER_SIGN_MESSAGE_PREFIX = 'Stellar Signed Message:\n';

export type WalletChallenge = {
  nonce: string;
  message: string;
  expiresAt: Date;
};

export type WalletChallengeVerification =
  | { ok: true }
  | { ok: false; status: number; error: string };

export type WalletChallengeCreation =
  | (WalletChallenge & { issuedAt: Date })
  | { ok: false; status: number; error: string };

export function isValidStellarPublicKey(walletAddress: string): boolean {
  try {
    Keypair.fromPublicKey(walletAddress);
    return true;
  } catch {
    return false;
  }
}

export function buildWalletChallengeMessage(input: {
  appName?: string;
  userId: string;
  walletAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const appName = input.appName ?? 'Secure Ticket';
  return [
    `${appName} wallet verification`,
    `user_id=${input.userId}`,
    `wallet_address=${input.walletAddress}`,
    `nonce=${input.nonce}`,
    `issued_at=${input.issuedAt.toISOString()}`,
    `expires_at=${input.expiresAt.toISOString()}`,
  ].join('\n');
}

export function createWalletChallenge(input: {
  userId: string;
  walletAddress: string;
  now?: Date;
  ttlMs?: number;
}): WalletChallengeCreation {
  const walletAddress = input.walletAddress.trim();
  if (!isValidStellarPublicKey(walletAddress)) {
    return { ok: false, status: 400, error: 'walletAddress Stellar invalida' };
  }

  const issuedAt = input.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + (input.ttlMs ?? WALLET_CHALLENGE_TTL_MS));
  const nonce = randomBytes(24).toString('base64url');
  const message = buildWalletChallengeMessage({
    userId: input.userId,
    walletAddress,
    nonce,
    issuedAt,
    expiresAt,
  });

  return { nonce, message, issuedAt, expiresAt };
}

export function verifyWalletChallengeSignature(input: {
  walletAddress: string;
  message: string;
  signature: string;
  expiresAt: Date;
  consumedAt?: Date | null;
  now?: Date;
}): WalletChallengeVerification {
  const walletAddress = input.walletAddress.trim();
  if (!isValidStellarPublicKey(walletAddress)) {
    return { ok: false, status: 400, error: 'walletAddress Stellar invalida' };
  }

  if (input.consumedAt) {
    return { ok: false, status: 409, error: 'Challenge ya fue usado' };
  }

  const now = input.now ?? new Date();
  if (input.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 410, error: 'Challenge expirado' };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(input.signature, 'base64');
  } catch {
    return { ok: false, status: 400, error: 'Firma invalida' };
  }

  if (signatureBytes.length === 0) {
    return { ok: false, status: 400, error: 'Firma requerida' };
  }

  const keypair = Keypair.fromPublicKey(walletAddress);
  if (signatureBytes.length !== 64) {
    return { ok: false, status: 400, error: 'Firma invalida' };
  }

  let isValid = false;
  try {
    const rawMessage = Buffer.from(input.message, 'utf8');
    const freighterMessageHash = createHash('sha256')
      .update(`${FREIGHTER_SIGN_MESSAGE_PREFIX}${input.message}`, 'utf8')
      .digest();
    isValid =
      keypair.verify(freighterMessageHash, signatureBytes) ||
      keypair.verify(rawMessage, signatureBytes);
  } catch {
    return { ok: false, status: 400, error: 'Firma invalida' };
  }
  if (!isValid) {
    return { ok: false, status: 403, error: 'Firma de wallet invalida' };
  }

  return { ok: true };
}
