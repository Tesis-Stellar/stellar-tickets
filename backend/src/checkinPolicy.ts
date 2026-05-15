export type CheckinResult = 'ALLOWED' | 'DENIED';
export type CheckinSource = 'db' | 'onchain';

export type CheckinPayloadSummary = {
  kind?: string;
  ticketId?: string;
  contractAddress?: string;
  ticketRootId?: number;
  version?: number;
  eventId?: string;
  nonce?: string;
  ownerWallet?: string | null;
};

export function buildCheckinPayloadSummary(input: Record<string, unknown>): CheckinPayloadSummary {
  if (typeof input.qrToken === 'string') {
    return { kind: 'signed_qr' };
  }
  if (typeof input.ticketId === 'string') {
    return { kind: 'legacy_ticket_id', ticketId: input.ticketId };
  }
  return { kind: 'unknown' };
}

export function summarizeScanRequest(input: {
  kind: 'ticketId' | 'contractTicket';
  ticketId?: string;
  contractAddress?: string;
  ticketRootId?: number;
  version?: number;
  eventId?: string;
  nonce?: string;
  ownerWallet?: string | null;
}): CheckinPayloadSummary {
  if (input.kind === 'ticketId') {
    return { kind: 'legacy_ticket_id', ticketId: input.ticketId };
  }
  return {
    kind: 'signed_qr',
    contractAddress: input.contractAddress,
    ticketRootId: input.ticketRootId,
    version: input.version,
    eventId: input.eventId,
    nonce: input.nonce,
    ownerWallet: input.ownerWallet,
  };
}
