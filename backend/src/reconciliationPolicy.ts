/**
 * Offline reconciliation between PostgreSQL `tickets` rows and processed rows in
 * `onchain_events` (indexer projection). It does not call Soroban RPC or verify
 * live contract storage; do not describe the report as full on-chain reconciliation.
 */
export type ReconciliationTicket = {
  id: string;
  contract_address: string | null;
  ticket_root_id: number | null;
  version: number | null;
  status: string;
  lifecycle_reason?: string | null;
};

export type ReconciliationEvent = {
  contract_address: string;
  ticket_root_id: number;
  version: number;
  event_name: string;
  status: string;
};

export type ReconciliationIssue = {
  severity: 'ERROR' | 'WARN';
  code: string;
  message: string;
  ticketId?: string;
  contractAddress?: string;
  ticketRootId?: number;
  version?: number;
};

function ticketKey(input: { contract_address: string | null; ticket_root_id: number | null; version: number | null }) {
  if (!input.contract_address || input.ticket_root_id == null || input.version == null) return null;
  return `${input.contract_address}:${input.ticket_root_id}:${input.version}`;
}

function eventKey(input: { contract_address: string; ticket_root_id: number; version: number }) {
  return `${input.contract_address}:${input.ticket_root_id}:${input.version}`;
}

export function buildReconciliationReport(input: {
  tickets: ReconciliationTicket[];
  events: ReconciliationEvent[];
}) {
  const issues: ReconciliationIssue[] = [];
  const processedEvents = input.events.filter((event) => event.status === 'PROCESSED');
  const eventsByKey = new Map(processedEvents.map((event) => [eventKey(event), event]));
  const ticketKeys = new Set<string>();

  for (const ticket of input.tickets) {
    const key = ticketKey(ticket);
    if (!key) {
      issues.push({
        severity: 'WARN',
        code: 'TICKET_WITHOUT_CHAIN_IDENTITY',
        message: 'Ticket without complete contract/root/version identity.',
        ticketId: ticket.id,
      });
      continue;
    }

    if (ticketKeys.has(key)) {
      issues.push({
        severity: 'ERROR',
        code: 'DUPLICATE_TICKET_VERSION',
        message: 'Multiple ticket rows share the same contract/root/version identity.',
        ticketId: ticket.id,
        contractAddress: ticket.contract_address ?? undefined,
        ticketRootId: ticket.ticket_root_id ?? undefined,
        version: ticket.version ?? undefined,
      });
    }
    ticketKeys.add(key);

    if (!eventsByKey.has(key)) {
      issues.push({
        severity: 'WARN',
        code: 'TICKET_WITHOUT_PROCESSED_EVENT',
        message: 'Versioned ticket has no matching processed on-chain event projection.',
        ticketId: ticket.id,
        contractAddress: ticket.contract_address ?? undefined,
        ticketRootId: ticket.ticket_root_id ?? undefined,
        version: ticket.version ?? undefined,
      });
    }
  }

  for (const event of processedEvents) {
    const key = eventKey(event);
    if (!ticketKeys.has(key)) {
      issues.push({
        severity: 'ERROR',
        code: 'PROCESSED_EVENT_WITHOUT_TICKET',
        message: 'Processed on-chain event has no matching ticket projection.',
        contractAddress: event.contract_address,
        ticketRootId: event.ticket_root_id,
        version: event.version,
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      ticketsChecked: input.tickets.length,
      processedEventsChecked: processedEvents.length,
      errors: issues.filter((issue) => issue.severity === 'ERROR').length,
      warnings: issues.filter((issue) => issue.severity === 'WARN').length,
    },
    issues,
    ok: issues.every((issue) => issue.severity !== 'ERROR'),
  };
}
