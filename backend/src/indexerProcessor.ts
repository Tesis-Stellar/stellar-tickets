import { assertActivePreviousVersion, buildTicketVersionIdentity, resolveResaleVersions } from './indexerResalePolicy';
import {
  buildCreatedTicketProjection,
  buildCursorUpdate,
  buildListingCancellationProjection,
  buildListingProjection,
  buildOnchainEventIdentity,
  buildRedemptionProjection,
  shouldSkipProcessedEvent,
  toJsonSafe,
} from './indexerEventPolicy';

type OnchainEventRecord = {
  id: string;
  txHash: string;
  ledger: number;
  ticketRootId: number;
  version: number;
};

export type IndexerProcessEventInput = {
  evt: any;
  eventName: string;
  contractId: string;
  topics: any[];
  data: any;
  fallbackLedger: number;
};

export type IndexerProcessEventResult =
  | { status: 'processed'; eventName: string; rootId: number | null; version: number | null }
  | { status: 'skipped'; reason: 'invalid_identity' | 'already_processed' };

export async function processIndexerEventsBatch(
  prisma: any,
  inputs: IndexerProcessEventInput[],
  endLedger: number,
): Promise<IndexerProcessEventResult[]> {
  const results: IndexerProcessEventResult[] = [];
  for (const input of inputs) {
    results.push(await processIndexerEvent(prisma, input));
  }
  const cursorUpdate = buildCursorUpdate(endLedger);
  await prisma.indexer_state.upsert({
    where: cursorUpdate.where,
    create: { id: cursorUpdate.where.id, last_ledger: cursorUpdate.data.last_ledger },
    update: { ...cursorUpdate.data, updated_at: new Date() },
  });
  return results;
}

export async function processIndexerEvent(prisma: any, input: IndexerProcessEventInput): Promise<IndexerProcessEventResult> {
  const { evt, eventName, contractId, topics, data, fallbackLedger } = input;
  const onchainEvent = await beginOnchainEvent(prisma, evt, eventName, contractId, topics, data, fallbackLedger);
  if (!onchainEvent) {
    const identity = buildOnchainEventIdentity({ evt, eventName, contractId, topics, data, fallbackLedger });
    return { status: identity ? 'skipped' : 'skipped', reason: identity ? 'already_processed' : 'invalid_identity' };
  }

  try {
    await applyIndexerProjection(prisma, { eventName, contractId, topics, data, onchainEvent });
    await markOnchainEvent(prisma, onchainEvent.id, 'PROCESSED');
    return {
      status: 'processed',
      eventName,
      rootId: onchainEvent.ticketRootId,
      version: onchainEvent.version,
    };
  } catch (eventError) {
    await markOnchainEvent(prisma, onchainEvent.id, 'FAILED');
    throw eventError;
  }
}

async function applyIndexerProjection(
  prisma: any,
  input: {
    eventName: string;
    contractId: string;
    topics: any[];
    data: any;
    onchainEvent: OnchainEventRecord;
  },
) {
  const { eventName, contractId, topics, data, onchainEvent } = input;

  if (eventName === 'boleto_creado') {
    const rootId = Number(topics[1]);
    const ownerWallet = data.propietario?.toString() ?? 'unknown';
    const user = ownerWallet !== 'unknown'
      ? await prisma.users.findUnique({ where: { wallet_address: ownerWallet } })
      : null;

    const existing = await prisma.tickets.findFirst({
      where: { contract_address: contractId, ticket_root_id: rootId, version: 0 },
    });

    if (!existing) {
      await prisma.tickets.create({
        data: buildCreatedTicketProjection({
          contractId,
          rootId,
          ownerWallet,
          ownerUserId: user?.id ?? null,
        }),
      });
    }
    return;
  }

  if (eventName === 'boleto_listado') {
    const rootId = Number(topics[1]);
    const resalePrice = data.precio != null ? BigInt(data.precio) : undefined;
    const listedVersion = data.version != null ? Number(data.version) : undefined;
    await prisma.tickets.updateMany(buildListingProjection({
      contractId,
      rootId,
      version: listedVersion,
      resalePrice,
    }));
    return;
  }

  if (eventName === 'venta_cancelada') {
    const rootId = Number(topics[1]);
    const cancelledVersion = data.version != null ? Number(data.version) : undefined;
    await prisma.tickets.updateMany(buildListingCancellationProjection({
      contractId,
      rootId,
      version: cancelledVersion,
    }));
    return;
  }

  if (eventName === 'boleto_comprado_primario') {
    const rootId = Number(topics[1]);
    const newOwnerWallet = data.comprador?.toString() ?? 'unknown';
    const user = newOwnerWallet !== 'unknown'
      ? await prisma.users.findUnique({ where: { wallet_address: newOwnerWallet } })
      : null;

    const existing = await prisma.tickets.findFirst({
      where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
      select: { id: true, is_for_sale: true, resale_price: true, order_item_id: true },
    });

    if (existing?.resale_price != null) {
      const alreadyCreated = await prisma.tickets.findFirst({
        where: { contract_address: contractId, ticket_root_id: rootId, version: 1 },
        select: { id: true },
      });
      await prisma.tickets.updateMany({
        where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'PRIMARY_P2P_REPLACED' },
      });
      if (!alreadyCreated) {
        await prisma.tickets.create({
          data: {
            contract_address: contractId,
            ticket_root_id: rootId,
            version: 1,
            owner_wallet: newOwnerWallet,
            owner_user_id: user?.id ?? null,
            order_item_id: existing.order_item_id,
            is_for_sale: false,
            status: 'ACTIVE',
          },
        });
      }
    } else {
      await prisma.tickets.updateMany({
        where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
        data: {
          owner_wallet: newOwnerWallet,
          owner_user_id: user?.id ?? null,
          is_for_sale: false,
        },
      });
    }
    return;
  }

  if (eventName === 'boleto_revendido') {
    const rootId = Number(topics[1]);
    const newOwnerWallet = data.comprador?.toString() ?? 'unknown';
    const { previousVersion, newVersion } = resolveResaleVersions(data, onchainEvent.version);
    const previousIdentity = buildTicketVersionIdentity(contractId, rootId, previousVersion);
    const newIdentity = buildTicketVersionIdentity(contractId, rootId, newVersion);
    const user = newOwnerWallet !== 'unknown'
      ? await prisma.users.findUnique({ where: { wallet_address: newOwnerWallet } })
      : null;

    const alreadyCreated = await prisma.tickets.findFirst({
      where: newIdentity,
      select: { id: true },
    });

    if (!alreadyCreated) {
      const oldTicket = await prisma.tickets.findFirst({
        where: previousIdentity,
        select: { order_item_id: true, status: true },
      });
      assertActivePreviousVersion(oldTicket, rootId, previousVersion);

      await prisma.$transaction([
        prisma.tickets.updateMany({
          where: { ...previousIdentity, status: 'ACTIVE' },
          data: { status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'RESOLD_PREVIOUS_VERSION' },
        }),
        prisma.tickets.create({
          data: {
            ...newIdentity,
            owner_wallet: newOwnerWallet,
            owner_user_id: user?.id ?? null,
            order_item_id: oldTicket.order_item_id ?? null,
            is_for_sale: false,
            status: 'ACTIVE',
          },
        }),
      ]);
    }
    return;
  }

  if (eventName === 'boleto_redimido') {
    const rootId = Number(topics[1]);
    await prisma.tickets.updateMany(buildRedemptionProjection({
      contractId,
      rootId,
      usedAt: new Date(),
    }));
    return;
  }

  if (eventName === 'boleto_invalidado_evt') {
    const rootId = Number(topics[1]);
    await prisma.tickets.updateMany({
      where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
      data: { status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'INVALIDATED_ONCHAIN' },
    });
  }
}

async function beginOnchainEvent(
  prisma: any,
  evt: any,
  eventName: string,
  contractId: string,
  topics: any[],
  data: any,
  fallbackLedger: number,
): Promise<OnchainEventRecord | null> {
  const identity = buildOnchainEventIdentity({ evt, eventName, contractId, topics, data, fallbackLedger });
  if (!identity) return null;
  const txHash = identity.tx_hash;
  const ledger = identity.ledger;
  const rootId = identity.ticket_root_id;
  const version = identity.version;

  const existing = await prisma.onchain_events.findFirst({
    where: identity,
    select: { id: true, status: true },
  });

  if (shouldSkipProcessedEvent(existing?.status)) {
    return null;
  }

  if (existing) {
    await prisma.onchain_events.update({
      where: { id: existing.id },
      data: { status: 'PROCESSING', processed_at: new Date(), payload: toJsonSafe({ topics, value: data }) },
    });
    return { id: existing.id, txHash, ledger, ticketRootId: rootId, version };
  }

  try {
    const created = await prisma.onchain_events.create({
      data: {
        ...identity,
        payload: toJsonSafe({ topics, value: data }),
        status: 'PROCESSING',
      },
      select: { id: true },
    });
    return { id: created.id, txHash, ledger, ticketRootId: rootId, version };
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const duplicate = await prisma.onchain_events.findFirst({
        where: identity,
        select: { id: true, status: true },
      });
      if (shouldSkipProcessedEvent(duplicate?.status)) return null;
      if (duplicate) {
        await prisma.onchain_events.update({
          where: { id: duplicate.id },
          data: { status: 'PROCESSING', processed_at: new Date(), payload: toJsonSafe({ topics, value: data }) },
        });
        return { id: duplicate.id, txHash, ledger, ticketRootId: rootId, version };
      }
    }
    throw error;
  }
}

async function markOnchainEvent(prisma: any, id: string, status: 'PROCESSED' | 'FAILED') {
  await prisma.onchain_events.update({
    where: { id },
    data: { status, processed_at: new Date() },
  });
}
