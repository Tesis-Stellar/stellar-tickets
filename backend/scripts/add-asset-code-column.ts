/**
 * Adds the asset_code column to the tickets table.
 *
 * asset_code: nullable TEXT, unique. Format: 'T' + first 11 hex chars of the
 * ticket UUID (uppercased). Encodes one classic Stellar asset per ticket so it
 * shows up as a collectible in Freighter.
 *
 * Run with prod DB:
 *   DATABASE_URL="<prod-url>" node --import tsx scripts/add-asset-code-column.ts
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('Adding asset_code column to ticketing.tickets...');
  await prisma.$executeRawUnsafe(`
    ALTER TABLE ticketing.tickets
    ADD COLUMN IF NOT EXISTS asset_code TEXT
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS tickets_asset_code_key
    ON ticketing.tickets (asset_code)
    WHERE asset_code IS NOT NULL
  `);
  console.log('✅ Column + unique index created');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
