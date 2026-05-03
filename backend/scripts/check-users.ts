import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const users = await p.users.findMany({
    where: { role: { in: ['ADMIN', 'STAFF'] } },
    select: { id: true, email: true, first_name: true, last_name: true, role: true, wallet_address: true }
  });
  
  if (users.length === 0) {
    console.log('❌ No hay usuarios ADMIN ni STAFF en la BD de pruebas.');
  } else {
    console.log(`✅ Encontrados ${users.length} usuario(s):`);
    console.log(JSON.stringify(users, null, 2));
  }

  // Also show total users
  const total = await p.users.count();
  console.log(`\nTotal usuarios en BD: ${total}`);
  
  await p.$disconnect();
}

main().catch(console.error);
