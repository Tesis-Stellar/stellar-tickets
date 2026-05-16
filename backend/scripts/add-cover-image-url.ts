import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ticketing.events ADD COLUMN IF NOT EXISTS cover_image_url TEXT`
  );
  console.log('OK: ticketing.events.cover_image_url ready');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
