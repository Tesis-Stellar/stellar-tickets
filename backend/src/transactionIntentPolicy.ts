export const TRANSACTION_INTENT_TTL_MS = 10 * 60 * 1000;

export type TransactionIntentStatus = 'PENDING' | 'SUBMITTED' | 'EXPIRED' | 'FAILED';

export type TransactionIntentSnapshot = {
  id: string;
  user_id: string;
  wallet_address: string;
  operation?: string;
  contract_address?: string;
  ticket_root_id?: number;
  expected_version?: number | null;
  expected_price?: bigint | number | null;
  xdr_hash: string;
  status: string;
  expires_at: Date;
  submitted_at?: Date | null;
};

export type TransactionIntentTicketSnapshot = {
  contract_address: string | null;
  ticket_root_id: number | null;
  version: number | null;
  owner_wallet: string | null;
  status: string;
  is_for_sale: boolean;
  resale_price: bigint | number | null;
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

export function authorizeTransactionIntentCurrentState(input: {
  intent: TransactionIntentSnapshot;
  ticket: TransactionIntentTicketSnapshot | null;
  walletAddress: string;
}): TransactionIntentDecision {
  const { intent, ticket, walletAddress } = input;
  if (!ticket) {
    return { ok: false, status: 409, error: 'Ticket de la intencion no encontrado o ya no esta activo' };
  }

  if (
    ticket.contract_address !== intent.contract_address ||
    ticket.ticket_root_id !== intent.ticket_root_id ||
    ticket.version !== intent.expected_version
  ) {
    return { ok: false, status: 409, error: 'La version actual del ticket no coincide con la intencion firmada' };
  }

  if (ticket.status !== 'ACTIVE') {
    return { ok: false, status: 409, error: `Ticket ya no esta activo: ${ticket.status}` };
  }

  if (intent.operation === 'listar_boleto') {
    if (ticket.owner_wallet !== walletAddress) {
      return { ok: false, status: 403, error: 'La wallet ya no coincide con el propietario del ticket' };
    }
    if (ticket.is_for_sale) {
      return { ok: false, status: 409, error: 'Ticket ya esta en venta' };
    }
    return { ok: true };
  }

  if (intent.operation === 'cancelar_venta') {
    if (ticket.owner_wallet !== walletAddress) {
      return { ok: false, status: 403, error: 'La wallet ya no coincide con el propietario del ticket' };
    }
    if (!ticket.is_for_sale) {
      return { ok: false, status: 409, error: 'Ticket ya no esta en venta' };
    }
    return { ok: true };
  }

  if (intent.operation === 'comprar_boleto') {
    if (!ticket.is_for_sale) {
      return { ok: false, status: 409, error: 'Ticket ya no esta en venta' };
    }
    if (ticket.owner_wallet === walletAddress) {
      return { ok: false, status: 403, error: 'No puedes comprar tu propio boleto' };
    }
    if (String(ticket.resale_price ?? '') !== String(intent.expected_price ?? '')) {
      return { ok: false, status: 409, error: 'El precio actual del ticket no coincide con la intencion firmada' };
    }
    return { ok: true };
  }

  return { ok: false, status: 400, error: `Operacion de intencion no soportada: ${intent.operation}` };
}
