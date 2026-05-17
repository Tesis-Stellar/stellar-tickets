import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app, { closeAppResources } from './server';
import { signTicketQr } from './qrPolicy';
import { buildSimulatedOrderNumber } from './checkoutPolicy';

process.env.VERCEL = '1';
process.env.RUN_INDEXER = 'false';
process.env.JWT_SECRET ||= 'stellar-tickets-dev-secret-change-in-prod';

const prisma = new PrismaClient();
const jwtSecret = process.env.JWT_SECRET;
const qrSecret = process.env.QR_SIGNING_SECRET || process.env.JWT_SECRET || 'stellar-tickets-dev-secret-change-in-prod';
const validWalletAddress = 'GC5DPWEAIL6KIPBB7D7NGSAGKTUFEBJATSZVVQLCZ2SVLT2RR3HJOFDQ';

function tokenFor(userId: string) {
  return jwt.sign({ userId }, jwtSecret);
}

async function testUserId(email: string) {
  const user = await prisma.users.findUnique({ where: { email }, select: { id: true } });
  assert.ok(user, `expected ${email} to exist`);
  return user.id;
}

async function createCustomerFixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prisma.users.create({
    data: {
      first_name: 'CI',
      last_name: label,
      email: `ci-${label.toLowerCase()}-${suffix}@stellar-tickets.local`,
      password_hash: 'unused',
      document_type: 'CC',
      document_number: `CI-${label.toUpperCase()}-${suffix}`,
      phone: '3000000000',
      role: 'CUSTOMER',
      is_active: true,
    },
    select: { id: true, email: true },
  });
}

async function createGeneralAdmissionEventFixture(label: string, options: { price?: number; serviceFee?: number; inventory?: number } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const category = await prisma.event_categories.upsert({
    where: { code: 'QA' },
    update: { is_active: true },
    create: { code: 'QA', display_name: 'QA', is_active: true },
  });
  const city = await prisma.cities.upsert({
    where: {
      country_code_department_name_city_name: {
        country_code: 'CO',
        department_name: 'Antioquia',
        city_name: 'Medellín',
      },
    },
    update: {},
    create: {
      country_code: 'CO',
      department_name: 'Antioquia',
      city_name: 'Medellín',
    },
  });
  const organizer = await prisma.organizers.create({
    data: {
      legal_name: `CI Organizer ${label} ${suffix}`,
      tax_identifier: `CI-${label.toUpperCase()}-${suffix}`,
      support_email: `support-${label}-${suffix}@stellar-tickets.local`,
    },
  });
  const venue = await prisma.venues.create({
    data: {
      name: `CI Venue ${label} ${suffix}`,
      city_id: city.id,
      address_line: 'Calle CI 123',
      venue_type: 'THEATER',
    },
  });
  const event = await prisma.events.create({
    data: {
      organizer_id: organizer.id,
      category_id: category.id,
      venue_id: venue.id,
      slug: `ci-${label.toLowerCase()}-${suffix}`,
      title: `CI ${label} ${suffix}`,
      description: 'Evento temporal para pruebas automatizadas',
      starts_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      has_assigned_seating: false,
      status: 'PUBLISHED',
    },
  });
  const ticketType = await prisma.event_ticket_types.create({
    data: {
      event_id: event.id,
      ticket_type_name: `General ${label}`,
      price_amount: options.price ?? 1000,
      service_fee_amount: options.serviceFee ?? 100,
      inventory_quantity: options.inventory ?? 50,
      max_per_order: 6,
      is_active: true,
    },
  });

  return { event, ticketType };
}

async function buyGeneralAdmissionTicket(input: {
  customerId: string;
  ticketTypeId: string;
  idempotencyKey: string;
  quantity?: number;
}) {
  const token = tokenFor(input.customerId);
  await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ ticketTypeId: input.ticketTypeId, quantity: input.quantity ?? 1 })
    .expect(200);
  const orderResponse = await request(app)
    .post('/api/checkout/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethod: 'CARD', idempotencyKey: input.idempotencyKey })
    .expect(200);
  const ticketId = orderResponse.body.items?.[0]?.id;
  assert.ok(ticketId, 'expected checkout response to include a ticket id');
  return { orderResponse, ticketId: String(ticketId) };
}

test.before(async () => {
  await prisma.users.upsert({
    where: { email: 'ci-supertest-admin@stellar-tickets.local' },
    create: {
      first_name: 'CI',
      last_name: 'Admin',
      email: 'ci-supertest-admin@stellar-tickets.local',
      password_hash: 'unused',
      document_type: 'CC',
      document_number: 'CI-ADMIN-1',
      role: 'ADMIN',
    },
    update: { role: 'ADMIN', is_active: true },
  });
  await prisma.users.upsert({
    where: { email: 'ci-supertest-customer@stellar-tickets.local' },
    create: {
      first_name: 'CI',
      last_name: 'Customer',
      email: 'ci-supertest-customer@stellar-tickets.local',
      password_hash: 'unused',
      document_type: 'CC',
      document_number: 'CI-CUSTOMER-1',
      role: 'CUSTOMER',
    },
    update: { role: 'CUSTOMER', is_active: true },
  });
  await prisma.users.upsert({
    where: { email: 'ci-supertest-staff@stellar-tickets.local' },
    create: {
      first_name: 'CI',
      last_name: 'Staff',
      email: 'ci-supertest-staff@stellar-tickets.local',
      password_hash: 'unused',
      document_type: 'CC',
      document_number: 'CI-STAFF-1',
      role: 'STAFF',
    },
    update: { role: 'STAFF', is_active: true },
  });
});

test.after(async () => {
  await prisma.$disconnect();
  await closeAppResources();
});

test('GET /health returns service status', async () => {
  const res = await request(app).get('/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.service, 'stellar-tickets-backend');
});

test('CORS allowlist permits configured local frontend origin', async () => {
  const res = await request(app)
    .get('/health')
    .set('Origin', 'http://localhost:5173')
    .expect(200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
});

test('POST /api/auth/login validates required credentials', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'missing-password@example.com' }).expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'Email y contraseña son requeridos');
  assert.ok(res.body.requestId);
});

test('POST /api/auth/login rejects invalid credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: `missing-${Date.now()}@example.com`, password: 'bad-password' })
    .expect(401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
  assert.equal(res.body.message, 'Credenciales inválidas');
  assert.ok(res.body.requestId);
});

test('POST /api/auth/register rejects duplicate identity documents with 409', async () => {
  const suffix = Date.now();
  const documentNumber = `REG-DOC-${suffix}`;

  await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Registro',
      lastName: 'Uno',
      email: `register-one-${suffix}@stellar-tickets.local`,
      password: 'Prueba1912',
      documentType: 'CC',
      documentNumber,
      phone: '3000000101',
    })
    .expect(200);

  const res = await request(app)
    .post('/api/auth/register')
    .send({
      firstName: 'Registro',
      lastName: 'Dos',
      email: `register-two-${suffix}@stellar-tickets.local`,
      password: 'Prueba1912',
      documentType: 'CC',
      documentNumber,
      phone: '3000000102',
    })
    .expect(409);

  assert.equal(res.body.code, 'CONFLICT');
  assert.equal(res.body.message, 'Ya existe una cuenta con ese documento de identidad');
  assert.ok(res.body.requestId);
});

test('GET /api/cart requires authentication', async () => {
  const res = await request(app).get('/api/cart').expect(401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
  assert.equal(res.body.message, 'Token requerido');
  assert.ok(res.body.requestId);
});

test('authenticated routes reject inactive users', async () => {
  const email = `inactive-${Date.now()}@example.com`;
  const inactiveUser = await prisma.users.create({
    data: {
      first_name: 'Inactive',
      last_name: 'User',
      email,
      password_hash: 'not-used',
      document_type: 'CC',
      document_number: `INACTIVE-${Date.now()}`,
      role: 'CUSTOMER',
      is_active: false,
    },
    select: { id: true },
  });

  try {
    const res = await request(app)
      .get('/api/cart')
      .set('Authorization', `Bearer ${tokenFor(inactiveUser.id)}`)
      .expect(403);
    assert.equal(res.body.code, 'USER_INACTIVE');
    assert.equal(res.body.message, 'Usuario inactivo');
    assert.ok(res.body.requestId);
  } finally {
    await prisma.users.delete({ where: { id: inactiveUser.id } }).catch(() => undefined);
  }
});

test('POST /api/cart/items returns 404 for unknown ticket type', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({ ticketTypeId: '00000000-0000-0000-0000-000000000002', quantity: 1 })
    .expect(404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.message, 'Tipo de boleta no encontrado');
  assert.ok(res.body.requestId);
});

test('POST /api/checkout/preview rejects an empty cart', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .post('/api/checkout/preview')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({})
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'El carrito está vacío');
  assert.ok(res.body.requestId);
});

test('POST /api/checkout/confirm rejects an empty customer cart', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .post('/api/checkout/confirm')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({ idempotencyKey: 'qa-unknown-user' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'El carrito está vacío');
  assert.ok(res.body.requestId);
});

test('POST /api/checkout/confirm creates one paid order and replays idempotently', async () => {
  const customer = await createCustomerFixture('Checkout');
  const { ticketType } = await createGeneralAdmissionEventFixture('Checkout', { price: 1200, serviceFee: 120, inventory: 20 });
  const token = tokenFor(customer.id);
  const idempotencyKey = `ci-checkout-${Date.now()}`;

  const cartItem = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ ticketTypeId: ticketType.id, quantity: 2 })
    .expect(200);
  assert.equal(cartItem.body.quantity, 2);

  const preview = await request(app)
    .post('/api/checkout/preview')
    .set('Authorization', `Bearer ${token}`)
    .send({})
    .expect(200);
  assert.equal(preview.body.subtotal, 2400);
  assert.equal(preview.body.serviceFees, 240);
  assert.equal(preview.body.total, 2640);
  assert.equal(preview.body.paymentMode, 'SIMULATED');

  const firstConfirm = await request(app)
    .post('/api/checkout/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethod: 'CARD', idempotencyKey })
    .expect(200);
  assert.equal(firstConfirm.body.status, 'confirmed');
  assert.equal(firstConfirm.body.total, 2640);
  assert.equal(firstConfirm.body.idempotentReplay, false);
  assert.equal(firstConfirm.body.items.length, 2);

  const replay = await request(app)
    .post('/api/checkout/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({ paymentMethod: 'CARD', idempotencyKey })
    .expect(200);
  assert.equal(replay.body.id, firstConfirm.body.id);
  assert.equal(replay.body.orderNumber, firstConfirm.body.orderNumber);
  assert.equal(replay.body.idempotentReplay, true);

  const orderNumber = buildSimulatedOrderNumber(idempotencyKey);
  const [orderCount, ticketCount, cart] = await Promise.all([
    prisma.orders.count({ where: { user_id: customer.id, order_number: orderNumber } }),
    prisma.tickets.count({ where: { owner_user_id: customer.id, order_items: { is: { order_id: firstConfirm.body.id } } } }),
    prisma.carts.findFirst({ where: { user_id: customer.id }, orderBy: { created_at: 'desc' }, select: { status: true } }),
  ]);
  assert.equal(orderCount, 1);
  assert.equal(ticketCount, 2);
  assert.equal(cart?.status, 'CONVERTED');
});

test('GET /api/orders/:id does not expose another customer order', async () => {
  const buyer = await createCustomerFixture('OrderOwner');
  const otherCustomer = await createCustomerFixture('OrderIntruder');
  const { ticketType } = await createGeneralAdmissionEventFixture('OrderAccess', { price: 900, serviceFee: 90 });
  const { orderResponse } = await buyGeneralAdmissionTicket({
    customerId: buyer.id,
    ticketTypeId: ticketType.id,
    idempotencyKey: `ci-order-access-${Date.now()}`,
  });

  const mine = await request(app)
    .get(`/api/orders/${orderResponse.body.id}`)
    .set('Authorization', `Bearer ${tokenFor(buyer.id)}`)
    .expect(200);
  assert.equal(mine.body.id, orderResponse.body.id);

  const blocked = await request(app)
    .get(`/api/orders/${orderResponse.body.id}`)
    .set('Authorization', `Bearer ${tokenFor(otherCustomer.id)}`)
    .expect(404);
  assert.equal(blocked.body.code, 'NOT_FOUND');
  assert.equal(blocked.body.message, 'Orden no encontrada');
  assert.ok(blocked.body.requestId);
});

test('GET /api/tickets/:id/resale-policy does not expose another customer ticket', async () => {
  const owner = await createCustomerFixture('TicketOwner');
  const intruder = await createCustomerFixture('TicketIntruder');
  const { ticketType } = await createGeneralAdmissionEventFixture('TicketAccess', { price: 1100, serviceFee: 110 });
  const { ticketId } = await buyGeneralAdmissionTicket({
    customerId: owner.id,
    ticketTypeId: ticketType.id,
    idempotencyKey: `ci-ticket-access-${Date.now()}`,
  });

  const mine = await request(app)
    .get(`/api/tickets/${ticketId}/resale-policy`)
    .set('Authorization', `Bearer ${tokenFor(owner.id)}`)
    .expect(200);
  assert.equal(mine.body.ticketStatus, 'ACTIVE');

  const blocked = await request(app)
    .get(`/api/tickets/${ticketId}/resale-policy`)
    .set('Authorization', `Bearer ${tokenFor(intruder.id)}`)
    .expect(404);
  assert.equal(blocked.body.code, 'NOT_FOUND');
  assert.equal(blocked.body.message, 'Ticket no encontrado');
  assert.ok(blocked.body.requestId);
});

test('POST /api/transactions/build-buy-xdr returns standard error envelope for missing input', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .post('/api/transactions/build-buy-xdr')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({})
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'contractAddress, ticketRootId y buyerPublicKey son requeridos');
  assert.ok(res.body.requestId);
});

test('POST /api/transactions/submit-classic returns standard error envelope for missing XDR', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .post('/api/transactions/submit-classic')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({})
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'signedXdr es requerido');
  assert.ok(res.body.requestId);
});

test('authenticated API rejects invalid and expired bearer tokens consistently', async () => {
  const invalid = await request(app)
    .get('/api/cart')
    .set('Authorization', 'Bearer token-corrupto')
    .expect(401);
  assert.equal(invalid.body.code, 'UNAUTHORIZED');
  assert.equal(invalid.body.message, 'Token inválido o expirado');
  assert.ok(invalid.body.requestId);

  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const expiredToken = jwt.sign({ userId: customerId }, jwtSecret, { expiresIn: -10 });
  const expired = await request(app)
    .get('/api/cart')
    .set('Authorization', `Bearer ${expiredToken}`)
    .expect(401);
  assert.equal(expired.body.code, 'UNAUTHORIZED');
  assert.equal(expired.body.message, 'Token inválido o expirado');
  assert.ok(expired.body.requestId);
});

test('POST /api/admin/scan rejects non-admin users before scanning', async () => {
  const customer = await prisma.users.findFirst({ where: { role: 'CUSTOMER' }, select: { id: true } });
  const userId = customer?.id ?? '00000000-0000-0000-0000-000000000005';

  const res = await request(app)
    .post('/api/admin/scan')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .send({ ticketId: '00000000-0000-0000-0000-000000000006' })
    .expect(403);
  assert.equal(res.body.code, 'FORBIDDEN');
  assert.equal(res.body.message, 'Acceso denegado');
  assert.ok(res.body.requestId);
});

test('POST /api/admin/scan validates malformed QR payloads for admins', async () => {
  const admin = await prisma.users.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin, 'expected at least one ADMIN user in the test database');

  const res = await request(app)
    .post('/api/admin/scan')
    .set('Authorization', `Bearer ${tokenFor(admin.id)}`)
    .send({ qrToken: 'not-a-token' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'QR firmado invalido');
  assert.ok(res.body.requestId);
});

test('POST /api/admin/scan accepts a signed QR once and records duplicate denial', async () => {
  const staffId = await testUserId('ci-supertest-staff@stellar-tickets.local');
  const owner = await createCustomerFixture('ScanOwner');
  const { event } = await createGeneralAdmissionEventFixture('Scan');
  const contractAddress = `C_SCAN_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const ticketRootId = Number(String(Date.now()).slice(-6));
  const ownerWallet = 'GA3GQMZLZBE4VTVNZPZ2SQZGR5F6TFVMHY65IQCY2MMZ4KUMRYWSOVRD';

  await prisma.events.update({
    where: { id: event.id },
    data: { contract_address: contractAddress },
  });
  const ticket = await prisma.tickets.create({
    data: {
      ticket_code: `CI-SCAN-${ticketRootId}`,
      owner_user_id: owner.id,
      owner_wallet: ownerWallet,
      contract_address: contractAddress,
      ticket_root_id: ticketRootId,
      version: 0,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  const qrToken = signTicketQr({
    secret: qrSecret,
    contractAddress,
    ticketRootId,
    version: 0,
    eventId: event.id,
    ownerWallet,
    nonce: `ci-scan-${ticketRootId}`,
  });

  const firstScan = await request(app)
    .post('/api/admin/scan')
    .set('Authorization', `Bearer ${tokenFor(staffId)}`)
    .send({ qrToken })
    .expect(200);
  assert.equal(firstScan.body.success, true);

  const usedTicket = await prisma.tickets.findUnique({
    where: { id: ticket.id },
    select: { status: true, lifecycle_reason: true, used_at: true },
  });
  assert.equal(usedTicket?.status, 'USED');
  assert.equal(usedTicket?.lifecycle_reason, 'REDEEMED_DB_SCAN');
  assert.ok(usedTicket?.used_at);

  const duplicate = await request(app)
    .post('/api/admin/scan')
    .set('Authorization', `Bearer ${tokenFor(staffId)}`)
    .send({ qrToken })
    .expect(409);
  assert.equal(duplicate.body.code, 'CONFLICT');
  assert.equal(duplicate.body.message, 'Boleto ya no esta activo: USED');

  const checkins = await prisma.checkins.findMany({
    where: { ticket_id: ticket.id },
    orderBy: { created_at: 'desc' },
    select: { result: true, source: true, reason: true },
  });
  assert.deepEqual(checkins.map((c) => c.result), ['DENIED', 'ALLOWED']);
  assert.equal(checkins[0].reason, 'Boleto ya no esta activo: USED');
  assert.equal(checkins[1].source, 'db');
});

test('POST /api/transactions/transfer-nft requires authentication', async () => {
  const res = await request(app).post('/api/transactions/transfer-nft').send({}).expect(401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
  assert.equal(res.body.message, 'Token requerido');
  assert.ok(res.body.requestId);
});

test('POST /api/transactions/submit requires a backend intent id', async () => {
  const res = await request(app)
    .post('/api/transactions/submit')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000009')}`)
    .send({ signedXdr: 'AAAA' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'signedXdr e intentId son requeridos');
  assert.ok(res.body.requestId);
});

test('POST /api/admin/events/:id/deploy rejects customers before deployment', async () => {
  const customer = await prisma.users.findFirst({ where: { role: 'CUSTOMER' }, select: { id: true } });
  const userId = customer?.id ?? '00000000-0000-0000-0000-000000000010';

  const res = await request(app)
    .post('/api/admin/events/00000000-0000-0000-0000-000000000011/deploy')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .send({})
    .expect(403);
  assert.equal(res.body.code, 'FORBIDDEN');
  assert.equal(res.body.message, 'Acceso denegado');
  assert.ok(res.body.requestId);
});

test('admin can configure resale policy and customers can read ticket resale evidence', async () => {
  const adminId = await testUserId('ci-supertest-admin@stellar-tickets.local');
  const customer = await createCustomerFixture('ResalePolicy');
  const { event, ticketType } = await createGeneralAdmissionEventFixture('ResalePolicy', { price: 2000, serviceFee: 200 });

  const savedPolicy = await request(app)
    .patch(`/api/admin/events/${event.id}/resale-policy`)
    .set('Authorization', `Bearer ${tokenFor(adminId)}`)
    .send({
      enabled: true,
      limitType: 'PERCENTAGE',
      maxPricePercent: 125,
      resaleStartsAt: null,
      resaleEndsAt: null,
      blockHoursBeforeEvent: 4,
      platformFeePercent: 3,
      organizerFeePercent: 7,
    })
    .expect(200);
  assert.equal(savedPolicy.body.eventId, event.id);
  assert.equal(savedPolicy.body.enabled, true);
  assert.equal(savedPolicy.body.limitType, 'PERCENTAGE');
  assert.equal(savedPolicy.body.maxPricePercent, 125);

  const { ticketId } = await buyGeneralAdmissionTicket({
    customerId: customer.id,
    ticketTypeId: ticketType.id,
    idempotencyKey: `ci-resale-policy-${Date.now()}`,
  });

  const evidence = await request(app)
    .get(`/api/tickets/${ticketId}/resale-policy`)
    .set('Authorization', `Bearer ${tokenFor(customer.id)}`)
    .expect(200);
  assert.equal(evidence.body.canList, true);
  assert.equal(evidence.body.ticketStatus, 'ACTIVE');
  assert.equal(evidence.body.event.id, event.id);
  assert.equal(evidence.body.ticketType.price, 2000);
  assert.equal(evidence.body.policy.originalPriceAmount, 2000);
  assert.equal(evidence.body.policy.maxPriceAmount, 2500);
  assert.equal(evidence.body.policy.platformFeePercent, 3);
  assert.equal(evidence.body.policy.organizerFeePercent, 7);
});

test('POST /api/wallet/challenge requires authentication', async () => {
  const res = await request(app).post('/api/wallet/challenge').send({}).expect(401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
  assert.equal(res.body.message, 'Token requerido');
  assert.ok(res.body.requestId);
});

test('POST /api/wallet/challenge rejects malformed Stellar wallets', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .post('/api/wallet/challenge')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({ walletAddress: 'not-a-stellar-public-key' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'walletAddress Stellar invalida');
  assert.ok(res.body.requestId);
});

test('operational roles cannot use customer purchase endpoints', async () => {
  const roles = [
    { label: 'admin', userId: await testUserId('ci-supertest-admin@stellar-tickets.local') },
    { label: 'staff', userId: await testUserId('ci-supertest-staff@stellar-tickets.local') },
  ];

  for (const role of roles) {
    const token = tokenFor(role.userId);

    const addToCart = await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ ticketTypeId: '00000000-0000-0000-0000-000000000002', quantity: 1 })
      .expect(403);
    assert.equal(addToCart.body.code, 'FORBIDDEN', role.label);
    assert.equal(addToCart.body.message, 'Las cuentas operativas no pueden comprar boletos');
    assert.ok(addToCart.body.requestId);

    const preview = await request(app)
      .post('/api/checkout/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
    assert.equal(preview.body.code, 'FORBIDDEN', role.label);
    assert.equal(preview.body.message, 'Las cuentas operativas no pueden comprar boletos');
    assert.ok(preview.body.requestId);

    const confirm = await request(app)
      .post('/api/checkout/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'CARD', idempotencyKey: `role-guard-${role.label}` })
      .expect(403);
    assert.equal(confirm.body.code, 'FORBIDDEN', role.label);
    assert.equal(confirm.body.message, 'Las cuentas operativas no pueden comprar boletos');
    assert.ok(confirm.body.requestId);
  }
});

test('operational roles cannot link wallets', async () => {
  const roles = [
    { label: 'admin', userId: await testUserId('ci-supertest-admin@stellar-tickets.local') },
    { label: 'staff', userId: await testUserId('ci-supertest-staff@stellar-tickets.local') },
  ];

  for (const role of roles) {
    const token = tokenFor(role.userId);

    const challenge = await request(app)
      .post('/api/wallet/challenge')
      .set('Authorization', `Bearer ${token}`)
      .send({ walletAddress: validWalletAddress })
      .expect(403);
    assert.equal(challenge.body.code, 'FORBIDDEN', role.label);
    assert.equal(challenge.body.message, 'Las cuentas operativas no pueden vincular wallet');
    assert.ok(challenge.body.requestId);

    const patch = await request(app)
      .patch('/api/users/me/wallet')
      .set('Authorization', `Bearer ${token}`)
      .send({ walletAddress: validWalletAddress, challengeId: 'challenge-id', signature: 'signature' })
      .expect(403);
    assert.equal(patch.body.code, 'FORBIDDEN', role.label);
    assert.equal(patch.body.message, 'Las cuentas operativas no pueden vincular wallet');
    assert.ok(patch.body.requestId);
  }
});

test('customer users can request a wallet proof challenge', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');

  const res = await request(app)
    .post('/api/wallet/challenge')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({ walletAddress: validWalletAddress })
    .expect(201);

  assert.ok(res.body.challengeId);
  assert.ok(String(res.body.message).includes('Secure Ticket wallet verification'));
  assert.ok(String(res.body.message).includes(`wallet_address=${validWalletAddress}`));
  assert.ok(res.body.expiresAt);
});

test('PATCH /api/users/me/wallet requires proof fields', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .patch('/api/users/me/wallet')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .send({ walletAddress: 'GA3GQMZLZBE4VTVNZPZ2SQZGR5F6TFVMHY65IQCY2MMZ4KUMRYWSOVRD' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'walletAddress, challengeId y signature son requeridos');
  assert.ok(res.body.requestId);
});

test('PQR claims preserve ticket evidence and staff can resolve with audit messages', async () => {
  const adminId = await testUserId('ci-supertest-admin@stellar-tickets.local');
  const customer = await createCustomerFixture('Claims');
  const otherCustomer = await createCustomerFixture('ClaimsOther');
  const { event, ticketType } = await createGeneralAdmissionEventFixture('Claims', { price: 1500, serviceFee: 150 });
  const { orderResponse, ticketId } = await buyGeneralAdmissionTicket({
    customerId: customer.id,
    ticketTypeId: ticketType.id,
    idempotencyKey: `ci-claims-${Date.now()}`,
  });

  const forbidden = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${tokenFor(otherCustomer.id)}`)
    .send({
      type: 'INVALID_QR',
      subject: 'Intento sobre ticket ajeno',
      description: 'No debe permitirse crear reclamos sobre tickets de otro usuario.',
      ticketId,
    })
    .expect(403);
  assert.equal(forbidden.body.code, 'FORBIDDEN');
  assert.equal(forbidden.body.message, 'No puedes reclamar un ticket de otro usuario');

  const created = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${tokenFor(customer.id)}`)
    .send({
      type: 'INVALID_QR',
      subject: 'QR no funciona en puerta',
      description: 'El QR fue rechazado durante la validación.',
      ticketId,
    })
    .expect(201);
  assert.equal(created.body.status, 'OPEN');
  assert.equal(created.body.ticketId, ticketId);
  assert.equal(created.body.orderId, orderResponse.body.id);
  assert.equal(created.body.eventId, event.id);
  assert.equal(created.body.evidence.ticket.id, ticketId);
  assert.equal(created.body.evidence.ticket.status, 'ACTIVE');
  assert.equal(created.body.evidence.order.status, 'PAID');
  assert.equal(created.body.evidence.event.id, event.id);
  assert.equal(created.body.messages.length, 1);

  const mine = await request(app)
    .get('/api/claims')
    .set('Authorization', `Bearer ${tokenFor(customer.id)}`)
    .expect(200);
  assert.ok(mine.body.some((claim: any) => claim.id === created.body.id));

  const updated = await request(app)
    .patch(`/api/admin/claims/${created.body.id}`)
    .set('Authorization', `Bearer ${tokenFor(adminId)}`)
    .send({
      status: 'RESOLVED',
      decisionReason: 'Evidencia revisada en prueba automatizada',
      message: 'Caso validado y cerrado por soporte.',
    })
    .expect(200);
  assert.equal(updated.body.status, 'RESOLVED');
  assert.equal(updated.body.decisionReason, 'Evidencia revisada en prueba automatizada');
  assert.ok(updated.body.resolvedAt);
  assert.equal(updated.body.messages.at(-1).statusFrom, 'OPEN');
  assert.equal(updated.body.messages.at(-1).statusTo, 'RESOLVED');
});

test('PQR claim detail and messages are protected from other customers', async () => {
  const owner = await createCustomerFixture('ClaimOwner');
  const intruder = await createCustomerFixture('ClaimIntruder');
  const { event, ticketType } = await createGeneralAdmissionEventFixture('ClaimAccess', { price: 1600, serviceFee: 160 });
  const { ticketId } = await buyGeneralAdmissionTicket({
    customerId: owner.id,
    ticketTypeId: ticketType.id,
    idempotencyKey: `ci-claim-access-${Date.now()}`,
  });

  const created = await request(app)
    .post('/api/claims')
    .set('Authorization', `Bearer ${tokenFor(owner.id)}`)
    .send({
      type: 'INVALID_QR',
      subject: 'QR rechazado',
      description: 'Necesito revisión del QR.',
      ticketId,
      eventId: event.id,
    })
    .expect(201);

  const blockedDetail = await request(app)
    .get(`/api/claims/${created.body.id}`)
    .set('Authorization', `Bearer ${tokenFor(intruder.id)}`)
    .expect(403);
  assert.equal(blockedDetail.body.code, 'FORBIDDEN');
  assert.equal(blockedDetail.body.message, 'No autorizado');
  assert.ok(blockedDetail.body.requestId);

  const blockedMessage = await request(app)
    .post(`/api/claims/${created.body.id}/messages`)
    .set('Authorization', `Bearer ${tokenFor(intruder.id)}`)
    .send({ message: 'Intento comentar un reclamo ajeno' })
    .expect(403);
  assert.equal(blockedMessage.body.code, 'FORBIDDEN');
  assert.equal(blockedMessage.body.message, 'No autorizado');
  assert.ok(blockedMessage.body.requestId);
});

test('customer users cannot read the admin claims directory', async () => {
  const customerId = await testUserId('ci-supertest-customer@stellar-tickets.local');
  const res = await request(app)
    .get('/api/admin/claims')
    .set('Authorization', `Bearer ${tokenFor(customerId)}`)
    .expect(403);
  assert.equal(res.body.code, 'FORBIDDEN');
  assert.equal(res.body.message, 'Acceso denegado');
  assert.ok(res.body.requestId);
});
