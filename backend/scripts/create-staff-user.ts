/**
 * Creates or updates a STAFF user for scanner/manual demo access.
 *
 * Usage:
 *   cd backend
 *   STAFF_EMAIL=staff.scanner@test.com STAFF_PASSWORD='Prueba1912' npx tsx scripts/create-staff-user.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env', override: true });

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const email = process.env.STAFF_EMAIL || 'staff@demo.com';
const password = process.env.STAFF_PASSWORD || 'Staff123';
const firstName = process.env.STAFF_FIRST_NAME || 'Staff';
const lastName = process.env.STAFF_LAST_NAME || 'Demo';
const documentType = process.env.STAFF_DOCUMENT_TYPE || 'CC';
const documentNumber = process.env.STAFF_DOCUMENT_NUMBER || '0000000000';
const phone = process.env.STAFF_PHONE || null;

async function main() {
  if (password.length < 8) {
    throw new Error('STAFF_PASSWORD debe tener al menos 8 caracteres');
  }

  await prisma.$executeRawUnsafe(
    "ALTER TYPE ticketing.user_role ADD VALUE IF NOT EXISTS 'STAFF'"
  );

  const password_hash = await bcrypt.hash(password, 10);
  const existing = await prisma.users.findUnique({ where: { email } });

  if (existing) {
    const updated = await prisma.users.update({
      where: { id: existing.id },
      data: {
        first_name: firstName,
        last_name: lastName,
        document_type: documentType,
        document_number: documentNumber,
        phone,
        password_hash,
        role: 'STAFF',
        is_active: true,
        updated_at: new Date(),
      },
      select: { id: true, email: true, role: true, is_active: true },
    });

    console.log(JSON.stringify({ action: 'updated', user: updated }, null, 2));
    return;
  }

  const created = await prisma.users.create({
    data: {
      email,
      password_hash,
      first_name: firstName,
      last_name: lastName,
      document_type: documentType,
      document_number: documentNumber,
      phone,
      role: 'STAFF',
      is_active: true,
    },
    select: { id: true, email: true, role: true, is_active: true },
  });

  console.log(JSON.stringify({ action: 'created', user: created }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
