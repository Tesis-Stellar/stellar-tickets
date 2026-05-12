import { PrismaClient } from '@prisma/client';
import { buildReconciliationReport } from '../src/reconciliationPolicy';

const prisma = new PrismaClient();

async function main() {
  const [tickets, events] = await Promise.all([
    prisma.tickets.findMany({
      where: {
        contract_address: { not: null },
        ticket_root_id: { not: null },
        version: { not: null },
      },
      select: {
        id: true,
        contract_address: true,
        ticket_root_id: true,
        version: true,
        status: true,
        lifecycle_reason: true,
      },
    }),
    prisma.onchain_events.findMany({
      select: {
        contract_address: true,
        ticket_root_id: true,
        version: true,
        event_name: true,
        status: true,
      },
    }),
  ]);

  const report = buildReconciliationReport({ tickets, events });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('[RECONCILE] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
