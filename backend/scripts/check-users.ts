import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const all = await p.users.findMany({
    select: { id: true, email: true, first_name: true, last_name: true, role: true, wallet_address: true }
  });
  const privileged = all.filter(u => ['ADMIN','STAFF'].includes(u.role));

  if (privileged.length === 0) {
    console.log('❌ No hay usuarios ADMIN ni STAFF.');
  } else {
    console.log(`✅ Encontrados ${privileged.length} usuario(s) privilegiados:`);
    console.log(JSON.stringify(privileged, null, 2));
  }
  console.log(`\nTotal usuarios en BD: ${all.length}`);
  await p.$disconnect();
}

main().catch(console.error);
