import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { assertActivePreviousVersion, buildTicketVersionIdentity, resolveResaleVersions } from './indexerResalePolicy';

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
                data: {
                  contract_address: contractId,
                  ticket_root_id: rootId,
                  version: 0,
                  owner_wallet: ownerWallet,
                  owner_user_id: user?.id ?? null,
                  is_for_sale: false,
                  status: 'ACTIVE',
                }
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
            await prisma.tickets.updateMany({
              where: {
                contract_address: contractId,
                ticket_root_id: rootId,
                status: 'ACTIVE',
                ...(listedVersion !== undefined ? { version: listedVersion } : {}),
              },
              data: { is_for_sale: true, ...(resalePrice !== undefined ? { resale_price: resalePrice } : {}) }
            });
            console.log(`[INDEXER] Listed ticket root_id=${rootId}`);
          }

          else if (eventName === 'venta_cancelada') {
            // Topics: [venta_cancelada, ticket_root_id, id_evento]
            const rootId = Number(topics[1]);
            const cancelledVersion = data.version != null ? Number(data.version) : undefined;
            await prisma.tickets.updateMany({
              where: {
                contract_address: contractId,
                ticket_root_id: rootId,
                status: 'ACTIVE',
                ...(cancelledVersion !== undefined ? { version: cancelledVersion } : {}),
              },
              data: { is_for_sale: false, resale_price: null }
            });
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
                data: { status: 'CANCELLED', is_for_sale: false }
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
                  data: { status: 'CANCELLED', is_for_sale: false }
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
            await prisma.tickets.updateMany({
              where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
              data: { status: 'USED', used_at: new Date(), is_for_sale: false }
            });
            console.log(`[INDEXER] Redeemed root_id=${rootId}`);
          }

          else if (eventName === 'boleto_invalidado_evt') {
            const rootId = Number(topics[1]);
            await prisma.tickets.updateMany({
              where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
              data: { status: 'CANCELLED', is_for_sale: false }
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
      await prisma.indexer_state.update({
        where: { id: 1 },
        data: { last_ledger: endLedger + 1, updated_at: new Date() }
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
  const rootId = normalizeTopicNumber(topics[1]);
  if (rootId === null) return null;

  const ledger = normalizeEventLedger(evt, fallbackLedger);
  const version = resolveEventVersion(eventName, data);
  const txHash = normalizeEventTxHash(evt, ledger, contractId, eventName, topics);
  const identity = {
    tx_hash: txHash,
    ledger,
    contract_address: contractId,
    event_name: eventName,
    ticket_root_id: rootId,
    version,
  };

  const existing = await prisma.onchain_events.findFirst({
    where: identity,
    select: { id: true, status: true },
  });

  if (existing?.status === 'PROCESSED') {
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
      if (duplicate?.status === 'PROCESSED') return null;
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

function normalizeTopicNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEventVersion(eventName: string, data: any): number {
  if (eventName === 'boleto_creado') return 0;
  if (eventName === 'boleto_revendido') return Number(data.version_nueva ?? -1);
  if (data.version != null) return Number(data.version);
  if (data.version_actual != null) return Number(data.version_actual);
  return -1;
}

function normalizeEventLedger(evt: any, fallbackLedger: number): number {
  const ledger = Number(evt.ledger ?? evt.ledgerSequence ?? evt.ledgerNumber ?? fallbackLedger);
  return Number.isFinite(ledger) ? ledger : fallbackLedger;
}

function normalizeEventTxHash(evt: any, ledger: number, contractId: string, eventName: string, topics: any[]): string {
  const explicit = evt.txHash ?? evt.transactionHash ?? evt.tx_hash ?? evt.id ?? evt.pagingToken;
  if (explicit) return String(explicit);
  return `${ledger}:${contractId}:${eventName}:${topics.map((t) => String(t)).join(':')}`;
}

function toJsonSafe(value: unknown): any {
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
