import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
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

dotenv.config();

const prisma = new PrismaClient();
const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL);
const SLEEP_MS = 5000;

type OnchainEventRecord = {
  id: string;
  txHash: string;
  ledger: number;
  ticketRootId: number;
  version: number;
};

/** Public Soroban RPC only retains recent ledgers; cursor older than min causes getEvents to fail. */
function parseRpcLedgerRangeError(message: string): { min: number; max: number } | null {
  const m = message.match(/ledger range:\s*(\d+)\s*-\s*(\d+)/i);
  if (!m) return null;
  return { min: Number(m[1]), max: Number(m[2]) };
}

export async function runIndexer() {
  console.log('[INDEXER] Starting Soroban Event Indexer...');

  while (true) {
    try {
      // 1. Get the current cursor from DB
      let state = await prisma.indexer_state.findFirst({ where: { id: 1 } });
      if (!state) {
        const latestInfo = await server.getLatestLedger();
        state = await prisma.indexer_state.create({
          data: { id: 1, last_ledger: latestInfo.sequence - 100 }
        });
      }

      // 2. Get active contracts to listen to
      const activeEvents = await prisma.events.findMany({
        where: { contract_address: { not: null } },
        select: { contract_address: true }
      });

      const contractIds = activeEvents.map(e => e.contract_address as string);

      if (contractIds.length === 0) {
        await sleep(SLEEP_MS);
        continue;
      }

      // 3. Fetch events from RPC
      const latestNetworkLedger = await server.getLatestLedger();
      const currentLedger = latestNetworkLedger.sequence;
      const startLedger = state.last_ledger;

      if (startLedger >= currentLedger) {
        await sleep(SLEEP_MS);
        continue;
      }

      const endLedger = Math.min(startLedger + 1000, currentLedger);

      // Soroban RPC allows max 5 contract IDs per filter — chunk them
      const CHUNK_SIZE = 5;
      let allEvents: any[] = [];
      try {
        for (let i = 0; i < contractIds.length; i += CHUNK_SIZE) {
          const chunk = contractIds.slice(i, i + CHUNK_SIZE);
          const eventsRes = await server.getEvents({
            startLedger,
            filters: [{ type: 'contract', contractIds: chunk, topics: [] } as any],
            limit: 1000,
          });
          allEvents = allEvents.concat(eventsRes.events);
        }
      } catch (rpcErr: any) {
        const msg = String(rpcErr?.message ?? rpcErr ?? '');
        const range = parseRpcLedgerRangeError(msg);
        if (range && startLedger < range.min) {
          console.warn(
            `[INDEXER] Cursor last_ledger=${startLedger} está antes del histórico del RPC (${range.min}–${range.max}). Se ajusta a ${range.min}.`
          );
          await prisma.indexer_state.update({
            where: { id: 1 },
            data: { last_ledger: range.min, updated_at: new Date() },
          });
          await sleep(SLEEP_MS);
          continue;
        }
        if (range && startLedger > range.max) {
          console.warn(`[INDEXER] Cursor last_ledger=${startLedger} por encima del rango del RPC; se ajusta a ${range.max}.`);
          await prisma.indexer_state.update({
            where: { id: 1 },
            data: { last_ledger: range.max, updated_at: new Date() },
          });
          await sleep(SLEEP_MS);
          continue;
        }
        throw rpcErr;
      }

      // 4. Process each event — names match contract #[contractevent] struct names
      for (const evt of allEvents) {
        const topics = parseTopics(evt.topic);
        const eventName = topics[0];
        const contractId = typeof evt.contractId === 'string' ? evt.contractId : evt.contractId?.toString();

        if (!eventName || !contractId) continue;

        let data: any;
        try {
          data = scValToNative(evt.value);
        } catch { continue; }

        console.log(`[INDEXER] Event: ${eventName} on ${contractId.slice(0, 8)}...`);

        const onchainEvent = await beginOnchainEvent(evt, eventName, contractId, topics, data, currentLedger);
        if (!onchainEvent) continue;

        try {
          if (eventName === 'boleto_creado') {
            // Topics: [boleto_creado, ticket_root_id, id_evento]
            // Value: { propietario, precio }
            const rootId = Number(topics[1]);
            const ownerWallet = data.propietario?.toString() ?? 'unknown';
            const user = ownerWallet !== 'unknown'
              ? await prisma.users.findUnique({ where: { wallet_address: ownerWallet } })
              : null;

            const existing = await prisma.tickets.findFirst({
              where: { contract_address: contractId, ticket_root_id: rootId, version: 0 }
            });

            if (!existing) {
              // Only create if not already tracked (e.g. from secure-ticket endpoint)
              await prisma.tickets.create({
                data: buildCreatedTicketProjection({
                  contractId,
                  rootId,
                  ownerWallet,
                  ownerUserId: user?.id ?? null,
                })
              });
              console.log(`[INDEXER] Created ticket root_id=${rootId}`);
            }
          }

          else if (eventName === 'boleto_listado') {
            // Topics: [boleto_listado, ticket_root_id, id_evento]
            // Value: { propietario, precio, version, es_reventa }
            const rootId = Number(topics[1]);
            const resalePrice = data.precio != null ? BigInt(data.precio) : undefined;
            const listedVersion = data.version != null ? Number(data.version) : undefined;
            await prisma.tickets.updateMany(buildListingProjection({
              contractId,
              rootId,
              version: listedVersion,
              resalePrice,
            }));
            console.log(`[INDEXER] Listed ticket root_id=${rootId}`);
          }

          else if (eventName === 'venta_cancelada') {
            // Topics: [venta_cancelada, ticket_root_id, id_evento]
            const rootId = Number(topics[1]);
            const cancelledVersion = data.version != null ? Number(data.version) : undefined;
            await prisma.tickets.updateMany(buildListingCancellationProjection({
              contractId,
              rootId,
              version: cancelledVersion,
            }));
            console.log(`[INDEXER] Cancelled listing root_id=${rootId}`);
          }

          else if (eventName === 'boleto_comprado_primario') {
            // Topics: [boleto_comprado_primario, ticket_root_id, id_evento]
            // Value: { vendedor, comprador, precio }
            const rootId = Number(topics[1]);
            const newOwnerWallet = data.comprador?.toString() ?? 'unknown';
            const user = newOwnerWallet !== 'unknown'
              ? await prisma.users.findUnique({ where: { wallet_address: newOwnerWallet } })
              : null;

            // Check if ticket was listed for P2P sale (has resale_price)
            const existing = await prisma.tickets.findFirst({
              where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
              select: { id: true, is_for_sale: true, resale_price: true, order_item_id: true },
            });

            if (existing?.resale_price != null) {
              // P2P sale via primary flow: cancel old ticket (keep resale_price for sale history)
              // and create new one for buyer, similar to boleto_revendido
              const alreadyCreated = await prisma.tickets.findFirst({
                where: { contract_address: contractId, ticket_root_id: rootId, version: 1 },
                select: { id: true },
              });
              await prisma.tickets.updateMany({
                where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
                data: { status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'PRIMARY_P2P_REPLACED' }
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
                  }
                });
              }
              console.log(`[INDEXER] Primary P2P sale root_id=${rootId} -> ${newOwnerWallet.slice(0, 8)} (seller ticket cancelled)`);
            } else {
              // Normal primary sale: ownership changes in-place, no version bump
              await prisma.tickets.updateMany({
                where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
                data: {
                  owner_wallet: newOwnerWallet,
                  owner_user_id: user?.id ?? null,
                  is_for_sale: false,
                }
              });
              console.log(`[INDEXER] Primary sale root_id=${rootId} -> ${newOwnerWallet.slice(0, 8)}`);
            }
          }

          else if (eventName === 'boleto_revendido') {
            // Topics: [boleto_revendido, ticket_root_id, id_evento]
            // Value: { vendedor, comprador, precio, version_anterior, version_nueva }
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
                  data: { status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'RESOLD_PREVIOUS_VERSION' }
                }),
                prisma.tickets.create({
                  data: {
                    ...newIdentity,
                    owner_wallet: newOwnerWallet,
                    owner_user_id: user?.id ?? null,
                    order_item_id: oldTicket.order_item_id ?? null,
                    is_for_sale: false,
                    status: 'ACTIVE',
                  }
                }),
              ]);
            }
            console.log(`[INDEXER] Resale root_id=${rootId} v${previousVersion}->v${newVersion} -> ${newOwnerWallet.slice(0, 8)}`);
          }

          else if (eventName === 'boleto_redimido') {
            // Topics: [boleto_redimido, ticket_root_id, id_evento]
            const rootId = Number(topics[1]);
            await prisma.tickets.updateMany(buildRedemptionProjection({
              contractId,
              rootId,
              usedAt: new Date(),
            }));
            console.log(`[INDEXER] Redeemed root_id=${rootId}`);
          }

          else if (eventName === 'boleto_invalidado_evt') {
            const rootId = Number(topics[1]);
            await prisma.tickets.updateMany({
              where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
              data: { status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'INVALIDATED_ONCHAIN' }
            });
            console.log(`[INDEXER] Invalidated root_id=${rootId}`);
          }

          await markOnchainEvent(onchainEvent.id, 'PROCESSED');
        } catch (eventError) {
          await markOnchainEvent(onchainEvent.id, 'FAILED');
          throw eventError;
        }
      }

      // 5. Update cursor
      const cursorUpdate = buildCursorUpdate(endLedger);
      await prisma.indexer_state.update({
        ...cursorUpdate,
        data: { ...cursorUpdate.data, updated_at: new Date() }
      });

    } catch (error) {
      console.error('[INDEXER] Error fetching/processing events', error);
      await sleep(SLEEP_MS);
    }
  }
}

function parseTopics(topicsXdr: xdr.ScVal[]): any[] {
  return topicsXdr.map(scv => {
    try {
      return scValToNative(scv);
    } catch {
      return null;
    }
  });
}

async function beginOnchainEvent(
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
    console.log(`[INDEXER] Skipping already processed ${eventName} tx=${txHash.slice(0, 12)} root=${rootId} v=${version}`);
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

async function markOnchainEvent(id: string, status: 'PROCESSED' | 'FAILED') {
  await prisma.onchain_events.update({
    where: { id },
    data: { status, processed_at: new Date() },
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
