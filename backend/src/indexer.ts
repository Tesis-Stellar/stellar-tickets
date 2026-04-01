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
          data: { id: 1, last_ledger: latestInfo.sequence - 100 } // Start slightly in the past
        });
      }

      // 2. Get active contracts to listen to
      const activeEvents = await prisma.events.findMany({
        where: { contract_address: { not: null } },
        select: { contract_address: true }
      });

      const contractIds = activeEvents.map(e => e.contract_address as string);

      if (contractIds.length === 0) {
        // Nothing to index yet
        await sleep(SLEEP_MS);
        continue;
      }

      // 3. Fetch events from RPC
      const latestNetworkLedger = await server.getLatestLedger();
      const currentLedger = latestNetworkLedger.sequence;
      let startLedger = state.last_ledger;

      if (startLedger >= currentLedger) {
        await sleep(SLEEP_MS);
        continue;
      }

      // RPC might reject ranges too large, fetch in chunks (max 10,000 ledgers)
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

      // 4. Process each event
      for (const evt of allEvents) {
        const topicExtracted = parseTopics(evt.topic);
        const eventName = topicExtracted[0]; 
        const contractId = typeof evt.contractId === 'string' ? evt.contractId : evt.contractId?.toString();

        // Skip events we can't parse or aren't tracking
        if (!eventName || !contractId) continue;
        
        let valueParsed;
        try {
           valueParsed = scValToNative(evt.value);
        } catch(e) { continue; } // ignore unparseable values

        // Mapping based on the Event Contract names
        if (eventName === 'Mint') {
          // e.g: ["Mint", boleto_root_id, owner, price]
          const ownerWallet = valueParsed.owner ?? 'unknown';
          const user = await prisma.users.findUnique({ where: { wallet_address: ownerWallet } });
          const ownerUserId = user ? user.id : null;
          const rootId = Number(valueParsed.root_id ?? topicExtracted[1]);

          const existing = await prisma.tickets.findFirst({
            where: {
              contract_address: contractId,
              ticket_root_id: rootId,
              version: 1
            }
          });

          if (!existing) {
            await prisma.tickets.create({
              data: {
                contract_address: contractId,
                ticket_root_id: rootId,
                version: 1,
                owner_wallet: ownerWallet,
                owner_user_id: ownerUserId,
                is_for_sale: false,
                status: 'ACTIVE'
              }
            });
          }
        } 
        else if (eventName === 'Venta') {
           // topic: ["Venta", root_id]
           const rootId = Number(topicExtracted[1]);
           await prisma.tickets.updateMany({
             where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
             data: { is_for_sale: true }
           });
        }
        else if (eventName === 'Compra') {
           // Includes both primary purchases and resales
           const rootId = Number(topicExtracted[1]);
           const data = valueParsed; // assumed { old_owner, new_owner, new_version, price }

           // 1. Invalidate previous version
           await prisma.tickets.updateMany({
             where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
             data: { status: 'CANCELLED', is_for_sale: false }
           });

           const newOwnerWallet = data.new_owner ?? 'unknown';
           const user = await prisma.users.findUnique({ where: { wallet_address: newOwnerWallet } });
           const ownerUserId = user ? user.id : null;

           // 2. Create new version
           await prisma.tickets.create({
             data: {
               contract_address: contractId,
               ticket_root_id: rootId,
               version: data.new_version ?? 2,
               owner_wallet: newOwnerWallet,
               owner_user_id: ownerUserId,
               is_for_sale: false,
               status: 'ACTIVE'
             }
           });
        }
        else if (eventName === 'Redimido') {
           const rootId = Number(topicExtracted[1]);
           await prisma.tickets.updateMany({
             where: { contract_address: contractId, ticket_root_id: rootId, status: 'ACTIVE' },
             data: { status: 'USED', is_for_sale: false }
           });
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
    } catch(e) {
      return null;
    }
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
