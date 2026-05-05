/**
 * Adds NFT columns for the Soroban-based collectible (Phase 4.5):
 *   - ticketing.events.nft_contract_address  TEXT (one NFT contract per event)
 *   - ticketing.tickets.nft_token_id         INTEGER (= ticket_root_id of event_contract)
 *
 * Run (defaults to .env):
 *   cd backend && npx tsx scripts/add-nft-columns.ts
 *
 * Run against prod DB:
 *   cd backend && ENV_FILE=.env.prod npx tsx scripts/add-nft-columns.ts
 */
import dotenv from 'dotenv';
const envFile = process.env.ENV_FILE || '.env';
dotenv.config({ path: envFile, override: true });
console.log(`[add-nft-columns] env: ${envFile}`);
console.log(`[add-nft-columns] DB host: ${(process.env.DATABASE_URL || '').match(/@([^/]+)/)?.[1] ?? '?'}`);

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ticketing.events
      ADD COLUMN IF NOT EXISTS nft_contract_address TEXT
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ticketing.tickets
      ADD COLUMN IF NOT EXISTS nft_token_id INTEGER
    `);
    console.log('OK columns added');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
