/**
 * Resets all ACTIVE tickets to "not secured on-chain" state in the DB so the
 * "Asegurar en Blockchain" button reappears. Does NOT touch on-chain assets
 * (those become orphaned in users' Freighter wallets — they can clear them
 * manually via Manage Assets → remove trustline).
 *
 * Run (defaults to .env):
 *   cd backend && npx tsx scripts/reset-tickets-secured.ts
 *
 * Run against prod DB:
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
    const result = await prisma.tickets.updateMany({
      where: { contract_address: { not: null }, status: 'ACTIVE' },
      data: {
        contract_address: null,
        ticket_root_id: null,
        version: null,
        owner_wallet: null,
        asset_code: null,
        is_for_sale: false,
        resale_price: null,
      },
    });
    console.log(`Reset ${result.count} tickets. El botón "Asegurar en Blockchain" volverá a aparecer.`);
    console.log('Nota: los assets siguen on-chain en wallets de usuarios. Si quieres limpiarlos, en Freighter → Manage Assets → eliminar.');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
