/**
 * create-staff-user.ts
 *
 * Crea un usuario STAFF para acceso al escáner QR.
 * Run: cd backend && ENV_FILE=.env.prod npx tsx scripts/create-staff-user.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env', override: true });

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const EMAIL = 'staff@demo.com';
const PASSWORD = 'Staff123';

const prisma = new PrismaClient();

async function main() {
  // Asegurar que el enum user_role incluya STAFF (idempotente).
  await prisma.$executeRawUnsafe(
    `ALTER TYPE ticketing.user_role ADD VALUE IF NOT EXISTS 'STAFF'`
  );
  console.log("Enum user_role: STAFF garantizado.");

  const password_hash = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.users.findFirst({ where: { email: EMAIL } });

  if (existing) {
    const updated = await prisma.users.update({
      where: { id: existing.id },
      data: { password_hash, role: 'STAFF', is_active: true },
    });
    console.log(`Usuario existente actualizado: ${updated.email} (role=${updated.role}, id=${updated.id})`);
  } else {
    const created = await prisma.users.create({
      data: {
        email: EMAIL,
        password_hash,
        first_name: 'Staff',
        last_name: 'Demo',
        document_type: 'CC',
        document_number: '0000000000',
        role: 'STAFF',
      },
    });
    console.log(`Usuario STAFF creado: ${created.email} (id=${created.id})`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
