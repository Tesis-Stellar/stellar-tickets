type TicketStatus = 'ACTIVE' | 'USED' | 'CANCELLED' | 'REFUNDED' | string;

export type ScanRequest =
  | { kind: 'ticketId'; ticketId: string }
  | { kind: 'contractTicket'; contractAddress: string; ticketRootId: number; version?: number };

export type ScanTicketSnapshot = {
  id: string;
  status: TicketStatus;
  version: number | null;
};

export type ScanPolicyError = { ok: false; status: 400 | 403 | 404 | 409; error: string };

export type ScanPolicyResult =
  | { ok: true; ticketId: string }
  | ScanPolicyError;

export function authorizeScannerRole(role: string | null | undefined): ScanPolicyError | null {
  if (role === 'ADMIN' || role === 'STAFF') return null;
  return { ok: false, status: 403, error: 'Acceso denegado' };
}

export function parseScanRequest(body: Record<string, unknown>): ScanRequest | ScanPolicyError {
  if (typeof body.ticketId === 'string' && body.ticketId.trim()) {
    return { kind: 'ticketId', ticketId: body.ticketId.trim() };
  }

  if (typeof body.contractAddress === 'string' && body.contractAddress.trim() && body.ticketRootId != null) {
    const ticketRootId = Number(body.ticketRootId);
    const version = body.version != null ? Number(body.version) : undefined;
    if (!Number.isFinite(ticketRootId) || (version !== undefined && !Number.isFinite(version))) {
      return { ok: false, status: 400, error: 'Payload de QR invalido' };
    }

    return {
      kind: 'contractTicket',
      contractAddress: body.contractAddress.trim(),
      ticketRootId,
      ...(version !== undefined ? { version } : {}),
    };
  }

  return { ok: false, status: 400, error: 'Se requiere ticketId o (contractAddress + ticketRootId)' };
}

export function evaluateScanTicket(ticket: ScanTicketSnapshot | null, requestedVersion?: number): ScanPolicyResult {
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

  if (ticket.status !== 'ACTIVE') {
    return { ok: false, status: 409, error: `Boleto ya no esta activo: ${ticket.status}` };
  }

  return { ok: true, ticketId: ticket.id };
}
