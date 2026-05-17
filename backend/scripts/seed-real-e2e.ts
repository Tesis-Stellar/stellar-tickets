import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const password = 'Prueba1912';

async function upsertUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
  documentNumber: string;
  phone: string;
}) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.users.upsert({
    where: { email: input.email },
    update: {
      first_name: input.firstName,
      last_name: input.lastName,
      password_hash: passwordHash,
      document_type: 'CC',
      document_number: input.documentNumber,
      phone: input.phone,
      role: input.role,
      is_active: true,
      deleted_at: null,
    },
    create: {
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      password_hash: passwordHash,
      document_type: 'CC',
      document_number: input.documentNumber,
      phone: input.phone,
      role: input.role,
      is_active: true,
    },
    select: { id: true, email: true, role: true },
  });
}

async function main() {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const slug = `e2e-real-${runId}`;
  const normalizedRunId = runId.replace(/[^a-zA-Z0-9]/g, '').slice(-14);

  const [customer, staff] = await Promise.all([
    upsertUser({
      email: `e2e.customer.${normalizedRunId}@stellar-tickets.local`,
      firstName: 'E2E',
      lastName: 'Cliente',
      role: 'CUSTOMER',
      documentNumber: `E2EC${normalizedRunId}`,
      phone: '3001112233',
    }),
    upsertUser({
      email: `e2e.staff.${normalizedRunId}@stellar-tickets.local`,
      firstName: 'E2E',
      lastName: 'Staff',
      role: 'STAFF',
      documentNumber: `E2ES${normalizedRunId}`,
      phone: '3004445566',
    }),
  ]);

  const category = await prisma.event_categories.upsert({
    where: { code: 'E2E' },
    update: { is_active: true },
    create: { code: 'E2E', display_name: 'E2E', is_active: true },
  });

  const city = await prisma.cities.upsert({
    where: {
      country_code_department_name_city_name: {
        country_code: 'CO',
        department_name: 'Cundinamarca',
        city_name: 'Bogotá',
      },
    },
    update: {},
    create: {
      country_code: 'CO',
      department_name: 'Cundinamarca',
      city_name: 'Bogotá',
    },
  });

  const organizer = await prisma.organizers.create({
    data: {
      legal_name: `Secure Ticket E2E ${runId}`,
      tax_identifier: `E2E-${normalizedRunId}`,
      support_email: `soporte.e2e.${normalizedRunId}@stellar-tickets.local`,
    },
  });

  const venue = await prisma.venues.create({
    data: {
      name: `Teatro E2E ${runId}`,
      city_id: city.id,
      address_line: 'Carrera E2E 123',
      venue_type: 'THEATER',
    },
  });

  const event = await prisma.events.create({
    data: {
      organizer_id: organizer.id,
      category_id: category.id,
      venue_id: venue.id,
      slug,
      title: `Secure Ticket E2E ${runId}`,
      description: 'Evento generado para Playwright real contra backend y PostgreSQL.',
      starts_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000),
      ends_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      has_assigned_seating: false,
      status: 'PUBLISHED',
    },
  });

  const ticketType = await prisma.event_ticket_types.create({
    data: {
      event_id: event.id,
      ticket_type_name: 'General E2E',
      price_amount: 42000,
      service_fee_amount: 4200,
      inventory_quantity: 12,
      max_per_order: 2,
      is_active: true,
    },
  });

  await prisma.event_resale_policies.create({
    data: {
      event_id: event.id,
      enabled: true,
      limit_type: 'PERCENTAGE',
      max_price_percent: 125,
      block_hours_before_event: 4,
      platform_fee_percent: 3,
      organizer_fee_percent: 5,
    },
  });

  console.log(JSON.stringify({
    password,
    customer,
    staff,
    event: {
      id: event.id,
      slug: event.slug,
      title: event.title,
    },
    ticketType: {
      id: ticketType.id,
      name: ticketType.ticket_type_name,
    },
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
