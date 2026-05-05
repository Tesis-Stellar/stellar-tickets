/**
 * Resetea tickets ACTIVE asegurados al estado "no asegurado" para que el botón
 * "Asegurar en Blockchain" reaparezca. NO toca los assets/NFTs on-chain (los
 * Classic assets siguen en wallets de usuarios; los NFTs Soroban siguen siendo
 * propiedad on-chain hasta que se queme el token).
 *
 * Run (defaults to .env):
 *   cd backend && npx tsx scripts/reset-tickets-secured.ts
 *
 * Run contra prod DB:
 *   cd backend && ENV_FILE=.env.prod npx tsx scripts/reset-tickets-secured.ts
 */
import dotenv from 'dotenv';
const envFile = process.env.ENV_FILE || '.env';
dotenv.config({ path: envFile, override: true });
console.log(`[reset-tickets-secured] env: ${envFile}`);
console.log(`[reset-tickets-secured] DB host: ${(process.env.DATABASE_URL || '').match(/@([^/]+)/)?.[1] ?? '?'}`);

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const before = await prisma.tickets.count({
      where: { contract_address: { not: null }, status: 'ACTIVE' },
    });
    console.log(`Tickets actualmente asegurados (ACTIVE): ${before}`);
    if (before === 0) {
      console.log('Nada que limpiar.');
      return;
    }
    // Raw SQL para tolerar DBs sin columnas asset_code/nft_token_id (schema parcial)
    const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='ticketing' AND table_name='tickets'
    `);
    const colNames = new Set(cols.map(c => c.column_name));
    const sets: string[] = [
      `contract_address=NULL`,
      `ticket_root_id=NULL`,
      `version=NULL`,
      `owner_wallet=NULL`,
      `is_for_sale=false`,
      `resale_price=NULL`,
    ];
    if (colNames.has('asset_code')) sets.push(`asset_code=NULL`);
    if (colNames.has('nft_token_id')) sets.push(`nft_token_id=NULL`);
    const count = await prisma.$executeRawUnsafe(`
      UPDATE ticketing.tickets SET ${sets.join(', ')}
      WHERE contract_address IS NOT NULL AND status='ACTIVE'
    `);
    console.log(`Reset ${count} tickets. El botón "Asegurar en Blockchain" volverá a aparecer.`);
    console.log('Nota: NFTs Soroban y assets Classic siguen on-chain. Para limpiarlos requeriría burns/clawbacks.');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
