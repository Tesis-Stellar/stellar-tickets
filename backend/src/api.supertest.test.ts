import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app, { closeAppResources } from './server';

process.env.VERCEL = '1';
process.env.RUN_INDEXER = 'false';
process.env.JWT_SECRET ||= 'stellar-tickets-dev-secret-change-in-prod';

const prisma = new PrismaClient();
const jwtSecret = process.env.JWT_SECRET;

function tokenFor(userId: string) {
  return jwt.sign({ userId }, jwtSecret);
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
    update: { is_active: true },
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
  const res = await request(app)
    .post('/api/cart/items')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000001')}`)
    .send({ ticketTypeId: '00000000-0000-0000-0000-000000000002', quantity: 1 })
    .expect(404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.message, 'Tipo de boleta no encontrado');
  assert.ok(res.body.requestId);
});

test('POST /api/checkout/preview rejects an empty cart', async () => {
  const res = await request(app)
    .post('/api/checkout/preview')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000003')}`)
    .send({})
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'El carrito está vacío');
  assert.ok(res.body.requestId);
});

test('POST /api/checkout/confirm returns 404 for unknown user', async () => {
  const res = await request(app)
    .post('/api/checkout/confirm')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000004')}`)
    .send({ idempotencyKey: 'qa-unknown-user' })
    .expect(404);
  assert.equal(res.body.code, 'NOT_FOUND');
  assert.equal(res.body.message, 'Usuario no encontrado');
  assert.ok(res.body.requestId);
});

test('POST /api/transactions/build-buy-xdr returns standard error envelope for missing input', async () => {
  const res = await request(app)
    .post('/api/transactions/build-buy-xdr')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000007')}`)
    .send({})
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'contractAddress, ticketRootId y buyerPublicKey son requeridos');
  assert.ok(res.body.requestId);
});

test('POST /api/transactions/submit-classic returns standard error envelope for missing XDR', async () => {
  const res = await request(app)
    .post('/api/transactions/submit-classic')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000008')}`)
    .send({})
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'signedXdr es requerido');
  assert.ok(res.body.requestId);
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

test('POST /api/wallet/challenge requires authentication', async () => {
  const res = await request(app).post('/api/wallet/challenge').send({}).expect(401);
  assert.equal(res.body.code, 'UNAUTHORIZED');
  assert.equal(res.body.message, 'Token requerido');
  assert.ok(res.body.requestId);
});

test('POST /api/wallet/challenge rejects malformed Stellar wallets', async () => {
  const res = await request(app)
    .post('/api/wallet/challenge')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000007')}`)
    .send({ walletAddress: 'not-a-stellar-public-key' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'walletAddress Stellar invalida');
  assert.ok(res.body.requestId);
});

test('PATCH /api/users/me/wallet requires proof fields', async () => {
  const res = await request(app)
    .patch('/api/users/me/wallet')
    .set('Authorization', `Bearer ${tokenFor('00000000-0000-0000-0000-000000000008')}`)
    .send({ walletAddress: 'GA3GQMZLZBE4VTVNZPZ2SQZGR5F6TFVMHY65IQCY2MMZ4KUMRYWSOVRD' })
    .expect(400);
  assert.equal(res.body.code, 'BAD_REQUEST');
  assert.equal(res.body.message, 'walletAddress, challengeId y signature son requeridos');
  assert.ok(res.body.requestId);
});
