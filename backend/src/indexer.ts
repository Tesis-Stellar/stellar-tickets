import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL);
const SLEEP_MS = 5000;

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
      for (let i = 0; i < contractIds.length; i += CHUNK_SIZE) {
        const chunk = contractIds.slice(i, i + CHUNK_SIZE);
        const eventsRes = await server.getEvents({
          startLedger,
          filters: [{ type: 'contract', contractIds: chunk, topics: [] } as any],
          limit: 1000,
        });
        allEvents = allEvents.concat(eventsRes.events);
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
          await prisma.tickets.updateMany({
            where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
            data: { is_for_sale: true }
          });
          console.log(`[INDEXER] Listed ticket root_id=${rootId}`);
        }

        else if (eventName === 'venta_cancelada') {
          // Topics: [venta_cancelada, ticket_root_id, id_evento]
          const rootId = Number(topics[1]);
          await prisma.tickets.updateMany({
            where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
            data: { is_for_sale: false }
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

          // Primary sale: ownership changes in-place, no version bump
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

        else if (eventName === 'boleto_revendido') {
          // Topics: [boleto_revendido, ticket_root_id, id_evento]
          // Value: { vendedor, comprador, precio, version_anterior, version_nueva }
          const rootId = Number(topics[1]);
          const newOwnerWallet = data.comprador?.toString() ?? 'unknown';
          const newVersion = Number(data.version_nueva ?? 1);
          const user = newOwnerWallet !== 'unknown'
            ? await prisma.users.findUnique({ where: { wallet_address: newOwnerWallet } })
            : null;

          // Cancel old version
          await prisma.tickets.updateMany({
            where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
            data: { status: 'CANCELLED', is_for_sale: false }
          });

          // Create new version
          await prisma.tickets.create({
            data: {
              contract_address: contractId,
              ticket_root_id: rootId,
              version: newVersion,
              owner_wallet: newOwnerWallet,
              owner_user_id: user?.id ?? null,
              is_for_sale: false,
              status: 'ACTIVE',
            }
          });
          console.log(`[INDEXER] Resale root_id=${rootId} v${newVersion} -> ${newOwnerWallet.slice(0, 8)}`);
        }

        else if (eventName === 'boleto_redimido') {
          // Topics: [boleto_redimido, ticket_root_id, id_evento]
          const rootId = Number(topics[1]);
          await prisma.tickets.updateMany({
            where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
            data: { status: 'USED', is_for_sale: false }
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
