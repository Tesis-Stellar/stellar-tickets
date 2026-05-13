/**
 * Borra filas de `tickets` huérfanas creadas por la carrera entre el indexer
 * y /secure-ticket: el indexer ve `boleto_creado` antes de que el endpoint
 * actualice la fila Web2 original, y crea una nueva fila sin order_item_id,
 * sin event, sin user — la "tarjeta vacía" que aparece en Mis Entradas.
 *
 * Una fila huérfana = tiene contract_address pero NO tiene order_item_id NI
 * owner_user_id (las legítimas siempre tienen una de las dos).
 *
 * Uso:
 *   ENV_FILE=.env.prod npx tsx scripts/cleanup-indexer-orphans.ts          # dry-run
 *   ENV_FILE=.env.prod APPLY=1 npx tsx scripts/cleanup-indexer-orphans.ts  # borra
 */
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env', override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const apply = process.env.APPLY === '1';
  console.log(`Target DB: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0]}`);
  console.log(`Mode: ${apply ? 'APPLY (will delete)' : 'DRY-RUN (no changes)'}`);

  const orphans = await prisma.tickets.findMany({
    where: {
      contract_address: { not: null },
      order_item_id: null,
      owner_user_id: null,
    },
    select: {
      id: true,
      contract_address: true,
      ticket_root_id: true,
      version: true,
      owner_wallet: true,
      created_at: true,
    },
    orderBy: { created_at: 'desc' },
  });

  console.log(`Found ${orphans.length} orphan ticket(s):`);
  for (const t of orphans) {
    console.log(
      `  ${t.id}  contract=${t.contract_address?.slice(0, 8)}…  root=${t.ticket_root_id}  v=${t.version}  owner=${t.owner_wallet?.slice(0, 8) ?? '(null)'}…  ${t.created_at.toISOString()}`,
    );
  }

  if (!apply) {
    console.log('\nDry-run. Re-run with APPLY=1 to delete.');
    await prisma.$disconnect();
    return;
  }
  if (orphans.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.tickets.deleteMany({
    where: { id: { in: orphans.map((o) => o.id) } },
  });
  console.log(`\nDeleted ${result.count} ticket(s).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
