/**
 * Resets on-chain fields on tickets whose contract_address points to a stale
 * (pre-redeploy) contract. Tickets are joined to their event via either
 * order_items.event_ticket_types or order_items.event_seat_inventory.
 *
 * Run with prod DB:
 *   DATABASE_URL="<prod-url>" node --import tsx scripts/cleanup-orphan-tickets.ts
 * Add CONFIRM=1 to actually apply the update; otherwise prints a dry-run summary.
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const apply = process.env.CONFIRM === '1';
  console.log(apply ? '🔥 APPLY MODE — will mutate DB' : '👀 DRY RUN — set CONFIRM=1 to apply');

  const tickets = await prisma.tickets.findMany({
    where: { contract_address: { not: null } },
    include: {
      order_items: {
        include: {
          event_ticket_types: { include: { events: { select: { id: true, title: true, contract_address: true } } } },
          event_seat_inventory: {
            include: {
              event_ticket_types: { include: { events: { select: { id: true, title: true, contract_address: true } } } },
            },
          },
        },
      },
    },
  });

  const orphans: { id: string; ticketContract: string | null; eventContract: string | null; eventTitle: string }[] = [];
  for (const t of tickets) {
    const event = t.order_items?.event_ticket_types?.events
      ?? t.order_items?.event_seat_inventory?.event_ticket_types?.events;
    if (!event) {
      orphans.push({ id: t.id, ticketContract: t.contract_address, eventContract: null, eventTitle: '(no event)' });
      continue;
    }
    if (event.contract_address !== t.contract_address) {
      orphans.push({ id: t.id, ticketContract: t.contract_address, eventContract: event.contract_address, eventTitle: event.title });
    }
  }

  console.log(`Tickets with contract_address: ${tickets.length}`);
  console.log(`Orphans (mismatch with event): ${orphans.length}`);
  for (const o of orphans.slice(0, 50)) {
    console.log(`  ${o.id} | event="${o.eventTitle}" | ticket→${o.ticketContract?.slice(0, 8)} | event→${o.eventContract?.slice(0, 8) ?? 'null'}`);
  }
  if (orphans.length > 50) console.log(`  ... and ${orphans.length - 50} more`);

  if (!apply || orphans.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const ids = orphans.map(o => o.id);
  const result = await prisma.tickets.updateMany({
    where: { id: { in: ids } },
    data: {
      contract_address: null,
      ticket_root_id: null,
      version: null,
      owner_wallet: null,
      is_for_sale: false,
      resale_price: null,
    },
  });
  console.log(`✅ Reset ${result.count} ticket(s)`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
