/**
 * Finds orphan ticket rows that can be left by older indexer/secure-ticket race
 * conditions. Dry-run by default.
 *
 * A cleanup candidate is intentionally strict:
 * - has on-chain identity
 * - has no owner_user_id and no order_item_id
 * - has no Web2 ticket_code or QR payload
 * - has no checkin audit rows
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/cleanup-indexer-orphans.ts
 *   APPLY=1 MAX_DELETE=25 npx tsx scripts/cleanup-indexer-orphans.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env', override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const apply = process.env.APPLY === '1';
const maxDelete = Number(process.env.MAX_DELETE ?? 25);

async function main() {
  if (!Number.isInteger(maxDelete) || maxDelete < 1) {
    throw new Error('MAX_DELETE debe ser un entero positivo');
  }

  const rows = await prisma.tickets.findMany({
    where: {
      contract_address: { not: null },
      ticket_root_id: { not: null },
      version: { not: null },
      order_item_id: null,
      owner_user_id: null,
      ticket_code: null,
      qr_payload: null,
    },
    select: {
      id: true,
      contract_address: true,
      ticket_root_id: true,
      version: true,
      owner_wallet: true,
      status: true,
      lifecycle_reason: true,
      created_at: true,
      _count: { select: { checkins: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  const candidates = rows.filter((ticket) => ticket._count.checkins === 0);

  console.log(`Mode: ${apply ? 'APPLY' : 'DRY_RUN'}`);
  console.log(`Candidates: ${candidates.length}`);

  for (const ticket of candidates.slice(0, 50)) {
    console.log(JSON.stringify({
      id: ticket.id,
      contractAddress: ticket.contract_address,
      ticketRootId: ticket.ticket_root_id,
      version: ticket.version,
      ownerWallet: ticket.owner_wallet,
      status: ticket.status,
      lifecycleReason: ticket.lifecycle_reason,
      createdAt: ticket.created_at,
    }));
  }

  if (!apply || candidates.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const ids = candidates.slice(0, maxDelete).map((ticket) => ticket.id);
  const result = await prisma.tickets.deleteMany({ where: { id: { in: ids } } });
  console.log(`Deleted: ${result.count}`);

  if (candidates.length > ids.length) {
    console.log(`Remaining candidates not deleted due to MAX_DELETE=${maxDelete}: ${candidates.length - ids.length}`);
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
