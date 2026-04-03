/**
 * One-time migration script:
 * 1. Adds resale_price column to tickets table (if not exists)
 * 2. Fixes owner_wallet on existing tickets (was set to organizer key, should be user's wallet)
 *
 * Run: npx tsx scripts/migrate-tickets.ts
 * Or:  node --loader tsx scripts/migrate-tickets.ts
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('=== Ticket Migration Script ===\n');

  // 1. Add resale_price column if it doesn't exist
  console.log('[1/2] Adding resale_price column...');
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ticketing.tickets ADD COLUMN IF NOT EXISTS resale_price BIGINT
    `);
    console.log('  -> resale_price column added (or already exists)\n');
  } catch (err: any) {
    console.error('  -> Error adding column:', err.message, '\n');
  }

  // 2. Fix owner_wallet: set to user's real wallet_address
  console.log('[2/2] Fixing owner_wallet on existing tickets...');
  try {
    const result = await prisma.$executeRawUnsafe(`
      UPDATE ticketing.tickets t
      SET owner_wallet = u.wallet_address
      FROM ticketing.users u
      WHERE t.owner_user_id = u.id
        AND u.wallet_address IS NOT NULL
        AND t.contract_address IS NOT NULL
    `);
    console.log(`  -> Updated ${result} ticket(s)\n`);
  } catch (err: any) {
    console.error('  -> Error updating owner_wallet:', err.message, '\n');
  }

  // Verification
  console.log('=== Verification ===');
  const tickets = await prisma.$queryRawUnsafe<any[]>(`
    SELECT t.id, t.ticket_root_id, t.owner_wallet, u.wallet_address as user_wallet, t.is_for_sale, t.contract_address IS NOT NULL as on_chain
    FROM ticketing.tickets t
    LEFT JOIN ticketing.users u ON t.owner_user_id = u.id
    WHERE t.contract_address IS NOT NULL
    ORDER BY t.created_at DESC
    LIMIT 10
  `);

  console.log(`On-chain tickets (last 10):`);
  for (const t of tickets) {
    const match = t.owner_wallet === t.user_wallet ? 'OK' : 'MISMATCH';
    console.log(`  #${t.ticket_root_id} | owner_wallet=${t.owner_wallet?.slice(0, 8)}... | user_wallet=${t.user_wallet?.slice(0, 8)}... | ${match} | for_sale=${t.is_for_sale}`);
  }

  console.log('\nDone!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
