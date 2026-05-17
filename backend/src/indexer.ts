import { rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { buildCursorUpdate } from './indexerEventPolicy';
import { processIndexerEvent } from './indexerProcessor';

dotenv.config();

const prisma = new PrismaClient();
const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const server = new rpc.Server(RPC_URL);
const SLEEP_MS = 5000;

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

        try {
          const processed = await processIndexerEvent(prisma, { evt, eventName, contractId, topics, data, fallbackLedger: currentLedger });
          if (processed.status === 'processed') {
            console.log(`[INDEXER] Processed ${eventName} root_id=${processed.rootId} v=${processed.version}`);
          }
        } catch (eventError) {
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
