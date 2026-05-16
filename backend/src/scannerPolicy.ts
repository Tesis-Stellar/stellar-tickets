import { verifyTicketQr } from './qrPolicy';

type TicketStatus = 'ACTIVE' | 'USED' | 'CANCELLED' | 'REFUNDED' | string;

export type ScanRequest =
  | { kind: 'ticketId'; ticketId: string }
  | { kind: 'contractTicket'; contractAddress: string; ticketRootId: number; version: number; eventId: string; nonce: string; exp: number; ownerWallet?: string | null };

export type ScanTicketSnapshot = {
  id: string;
  status: TicketStatus;
  version: number | null;
  ownerWallet?: string | null;
};

export type ScanPolicyError = { ok: false; status: 400 | 403 | 404 | 409; error: string };

export type ScanPolicyResult =
  | { ok: true; ticketId: string }
  | ScanPolicyError;

export function authorizeScannerRole(role: string | null | undefined): ScanPolicyError | null {
  if (role === 'ADMIN' || role === 'STAFF') return null;
  return { ok: false, status: 403, error: 'Acceso denegado' };
}

export function parseScanRequest(body: Record<string, unknown>, options?: { qrSecret?: string; allowLegacyTicketId?: boolean }): ScanRequest | ScanPolicyError {
  if (typeof body.ticketId === 'string' && body.ticketId.trim()) {
    if (!options?.allowLegacyTicketId) {
      return { ok: false, status: 400, error: 'QR firmado requerido; ticketId legacy deshabilitado' };
    }
    return { kind: 'ticketId', ticketId: body.ticketId.trim() };
  }

  if (typeof body.qrToken === 'string' && body.qrToken.trim()) {
    if (!options?.qrSecret) {
      return { ok: false, status: 400, error: 'Configuracion de firma QR no disponible' };
    }
    const verification = verifyTicketQr({ token: body.qrToken.trim(), secret: options.qrSecret });
    if (!verification.ok) {
      return verification;
    }
    return {
      kind: 'contractTicket',
      contractAddress: verification.claims.contractAddress,
      ticketRootId: verification.claims.ticketRootId,
      version: verification.claims.version,
      eventId: verification.claims.eventId,
      nonce: verification.claims.nonce,
      exp: verification.claims.exp,
      ownerWallet: verification.claims.ownerWallet ?? null,
    };
  }

  if (typeof body.contractAddress === 'string' && body.contractAddress.trim() && body.ticketRootId != null) {
    return { ok: false, status: 400, error: 'QR firmado requerido' };
  }

  return { ok: false, status: 400, error: 'Se requiere qrToken firmado' };
}

export function evaluateScanTicket(ticket: ScanTicketSnapshot | null, requestedVersion?: number, requestedOwnerWallet?: string | null): ScanPolicyResult {
  if (!ticket) {
    return { ok: false, status: 404, error: 'Boleto no encontrado' };
  }

  if (requestedVersion != null && ticket.version != null && requestedVersion !== ticket.version) {
    return {
      ok: false,
      status: 409,
      error: 'QR vencido: este boleto fue revendido. El nuevo dueño tiene el QR válido.',
    };
  }

  if (requestedOwnerWallet && ticket.ownerWallet && requestedOwnerWallet !== ticket.ownerWallet) {
    return {
      ok: false,
      status: 409,
      error: 'QR vencido: el dueño on-chain de este boleto cambió. El nuevo dueño tiene el QR válido.',
    };
  }

  if (ticket.status !== 'ACTIVE') {
    return { ok: false, status: 409, error: `Boleto ya no esta activo: ${ticket.status}` };
  }

  return { ok: true, ticketId: ticket.id };
}
