import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const stadium = await prisma.events.findFirst({ where: { slug: 'clasico-capital-2026' } });
  if (!stadium) { console.log('event not found'); return; }

  // Bypass triggers via session_replication_role (requires superuser or pg_roles)
  await prisma.$executeRawUnsafe(`SET session_replication_role = replica`);

  const r1 = await prisma.$executeRawUnsafe(
    `UPDATE ticketing.event_ticket_types SET ticket_type_name = 'Sur' WHERE event_id = '${stadium.id}'::uuid AND ticket_type_name = 'VIP'`
  );
  const r2 = await prisma.$executeRawUnsafe(
    `UPDATE ticketing.event_ticket_types SET ticket_type_name = 'Norte' WHERE event_id = '${stadium.id}'::uuid AND ticket_type_name = 'Platea'`
  );
  console.log('Renamed VIP→Sur:', r1, 'Platea→Norte:', r2);

  await prisma.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
  console.log('Done');
}

main().catch(console.error).finally(() => prisma.$disconnect());
