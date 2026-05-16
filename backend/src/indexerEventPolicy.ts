export type OnchainEventIdentity = {
  tx_hash: string;
  ledger: number;
  contract_address: string;
  event_name: string;
  ticket_root_id: number;
  version: number;
};

export function buildOnchainEventIdentity(input: {
  evt: any;
  eventName: string;
  contractId: string;
  topics: unknown[];
  data: any;
  fallbackLedger: number;
}): OnchainEventIdentity | null {
  const rootId = normalizeTopicNumber(input.topics[1]);
  if (rootId === null) return null;

  const ledger = normalizeEventLedger(input.evt, input.fallbackLedger);
  const version = resolveEventVersion(input.eventName, input.data);
  const txHash = normalizeEventTxHash(input.evt, ledger, input.contractId, input.eventName, input.topics);

  return {
    tx_hash: txHash,
    ledger,
    contract_address: input.contractId,
    event_name: input.eventName,
    ticket_root_id: rootId,
    version,
  };
}

export function shouldSkipProcessedEvent(status: string | null | undefined) {
  return status === 'PROCESSED';
}

export function buildCreatedTicketProjection(input: {
  contractId: string;
  rootId: number;
  ownerWallet: string;
  ownerUserId?: string | null;
}) {
  return {
    contract_address: input.contractId,
    ticket_root_id: input.rootId,
    version: 0,
    owner_wallet: input.ownerWallet,
    owner_user_id: input.ownerUserId ?? null,
    is_for_sale: false,
    status: 'ACTIVE' as const,
  };
}

export function buildListingProjection(input: {
  contractId: string;
  rootId: number;
  version?: number;
  resalePrice?: bigint;
}) {
  return {
    where: {
      contract_address: input.contractId,
      ticket_root_id: input.rootId,
      status: 'ACTIVE' as const,
      ...(input.version !== undefined ? { version: input.version } : {}),
    },
    data: {
      is_for_sale: true,
      ...(input.resalePrice !== undefined ? { resale_price: input.resalePrice } : {}),
      lifecycle_reason: 'LISTED_FOR_RESALE' as const,
    },
  };
}

export function buildListingCancellationProjection(input: {
  contractId: string;
  rootId: number;
  version?: number;
}) {
  return {
    where: {
      contract_address: input.contractId,
      ticket_root_id: input.rootId,
      status: 'ACTIVE' as const,
      ...(input.version !== undefined ? { version: input.version } : {}),
    },
    data: {
      is_for_sale: false,
      resale_price: null,
      lifecycle_reason: 'LISTING_CANCELLED' as const,
    },
  };
}

export function buildRedemptionProjection(input: {
  contractId: string;
  rootId: number;
  usedAt: Date;
}) {
  return {
    where: {
      contract_address: input.contractId,
      ticket_root_id: input.rootId,
      status: 'ACTIVE' as const,
    },
    data: {
      status: 'USED' as const,
      used_at: input.usedAt,
      is_for_sale: false,
      lifecycle_reason: 'REDEEMED_ONCHAIN' as const,
    },
  };
}

export function buildCursorUpdate(endLedger: number) {
  return {
    where: { id: 1 },
    data: { last_ledger: endLedger + 1 },
  };
}

export function normalizeTopicNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveEventVersion(eventName: string, data: any): number {
  if (eventName === 'boleto_creado') return 0;
  if (eventName === 'boleto_revendido') return Number(data.version_nueva ?? -1);
  if (data.version != null) return Number(data.version);
  if (data.version_actual != null) return Number(data.version_actual);
  return -1;
}

export function normalizeEventLedger(evt: any, fallbackLedger: number): number {
  const ledger = Number(evt.ledger ?? evt.ledgerSequence ?? evt.ledgerNumber ?? fallbackLedger);
  return Number.isFinite(ledger) ? ledger : fallbackLedger;
}

export function normalizeEventTxHash(evt: any, ledger: number, contractId: string, eventName: string, topics: unknown[]): string {
  const explicit = evt.txHash ?? evt.transactionHash ?? evt.tx_hash ?? evt.id ?? evt.pagingToken;
  if (explicit) return String(explicit);
  return `${ledger}:${contractId}:${eventName}:${topics.map((t) => String(t)).join(':')}`;
}

export function toJsonSafe(value: unknown): any {
  if (typeof value === 'bigint') return value.toString();
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const maybeAddress = (value as { toString?: () => string }).toString;
    if (maybeAddress && maybeAddress !== Object.prototype.toString) {
      const rendered = maybeAddress.call(value);
      if (rendered !== '[object Object]') return rendered;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, toJsonSafe(nested)])
    );
  }
  return String(value);
}
