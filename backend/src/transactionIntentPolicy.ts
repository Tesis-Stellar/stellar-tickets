export const TRANSACTION_INTENT_TTL_MS = 10 * 60 * 1000;

export type TransactionIntentStatus = 'PENDING' | 'SUBMITTED' | 'EXPIRED' | 'FAILED';

export type TransactionIntentSnapshot = {
  id: string;
  user_id: string;
  wallet_address: string;
  xdr_hash: string;
  status: string;
  expires_at: Date;
  submitted_at?: Date | null;
};

export type TransactionIntentDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 409; error: string; markExpired?: boolean };

export function buildTransactionIntentExpiry(now = new Date()): Date {
  return new Date(now.getTime() + TRANSACTION_INTENT_TTL_MS);
}

export function authorizeTransactionIntentSubmit(input: {
  intent: TransactionIntentSnapshot | null;
  userId: string;
  walletAddress: string;
  signedXdrHash: string;
  now?: Date;
}): TransactionIntentDecision {
  if (!input.intent) {
    return { ok: false, status: 400, error: 'Intencion de transaccion no encontrada' };
  }

  if (input.intent.user_id !== input.userId || input.intent.wallet_address !== input.walletAddress) {
    return { ok: false, status: 403, error: 'La intencion no pertenece al usuario o wallet autenticada' };
  }

  if (input.intent.status !== 'PENDING' || input.intent.submitted_at) {
    return { ok: false, status: 409, error: `Intencion de transaccion no pendiente: ${input.intent.status}` };
  }

  const now = input.now ?? new Date();
  if (input.intent.expires_at.getTime() <= now.getTime()) {
    return { ok: false, status: 409, error: 'Intencion de transaccion expirada', markExpired: true };
  }

  if (input.intent.xdr_hash !== input.signedXdrHash) {
    return { ok: false, status: 403, error: 'La transaccion firmada no coincide con la intencion autorizada' };
  }

  return { ok: true };
}
