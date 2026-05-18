import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { processIndexerEvent, processIndexerEventsBatch } from './indexerProcessor';
import { authorizeVerifiedNftTransfer } from './nftTransferPolicy';

process.env.VERCEL = '1';
process.env.RUN_INDEXER = 'false';

const prisma = new PrismaClient();

async function createIndexerFixture(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const contractAddress = `C_IDX_${label}_${suffix}`;
  const nftContractAddress = `N_IDX_${label}_${suffix}`;
  const sellerWallet = `GSELLER_${label}_${suffix}`;
  const buyerWallet = `GBUYER_${label}_${suffix}`;

  const [seller, buyer] = await Promise.all([
    prisma.users.create({
      data: {
        first_name: 'Indexer',
        last_name: `Seller ${label}`,
        email: `indexer-seller-${label}-${suffix}@stellar-tickets.local`,
        password_hash: 'unused',
        document_type: 'CC',
        document_number: `IDX-SELLER-${label}-${suffix}`,
        role: 'CUSTOMER',
        is_active: true,
        wallet_address: sellerWallet,
      },
    }),
    prisma.users.create({
      data: {
        first_name: 'Indexer',
        last_name: `Buyer ${label}`,
        email: `indexer-buyer-${label}-${suffix}@stellar-tickets.local`,
        password_hash: 'unused',
        document_type: 'CC',
        document_number: `IDX-BUYER-${label}-${suffix}`,
        role: 'CUSTOMER',
        is_active: true,
        wallet_address: buyerWallet,
      },
    }),
  ]);

  const category = await prisma.event_categories.upsert({
    where: { code: 'IDX' },
    update: { is_active: true },
    create: { code: 'IDX', display_name: 'Indexer QA', is_active: true },
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
      legal_name: `Indexer Organizer ${label} ${suffix}`,
      tax_identifier: `IDX-ORG-${label}-${suffix}`,
    },
  });
  const venue = await prisma.venues.create({
    data: {
      name: `Indexer Venue ${label} ${suffix}`,
      city_id: city.id,
      address_line: 'Calle Indexer 123',
      venue_type: 'THEATER',
    },
  });
  const event = await prisma.events.create({
    data: {
      organizer_id: organizer.id,
      category_id: category.id,
      venue_id: venue.id,
      slug: `indexer-${label}-${suffix}`,
      title: `Indexer ${label} ${suffix}`,
      starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000),
      status: 'PUBLISHED',
      contract_address: contractAddress,
      nft_contract_address: nftContractAddress,
    },
  });

  return { event, contractAddress, nftContractAddress, seller, buyer, sellerWallet, buyerWallet };
}

test.after(async () => {
  await prisma.$disconnect();
});

test('INT-SYNC-01 projects normalized Soroban lifecycle fixtures into PostgreSQL without duplicate processing', async () => {
  // INT-SYNC-01 usa eventos Soroban normalizados/mockeados y PostgreSQL real
  // via Prisma. La prueba no consume Stellar Testnet: la ejecucion Testnet queda
  // cubierta por la guia manual E2E-REV-01.
  const fixture = await createIndexerFixture('sync');
  const rootId = Number(String(Date.now()).slice(-6));
  const redeemRootId = rootId + 1;
  const invalidatedRootId = rootId + 2;

  const created = await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-created-${rootId}`, ledger: 501 },
    eventName: 'boleto_creado',
    contractId: fixture.contractAddress,
    topics: ['boleto_creado', rootId],
    data: { propietario: fixture.sellerWallet },
    fallbackLedger: 501,
  });
  assert.equal(created.status, 'processed');

  const ticket = await prisma.tickets.findFirstOrThrow({
    where: { contract_address: fixture.contractAddress, ticket_root_id: rootId, version: 0 },
    select: {
      contract_address: true,
      ticket_root_id: true,
      version: true,
      owner_wallet: true,
      owner_user_id: true,
      status: true,
      is_for_sale: true,
      resale_price: true,
    },
  });
  assert.deepEqual(ticket, {
    contract_address: fixture.contractAddress,
    ticket_root_id: rootId,
    version: 0,
    owner_wallet: fixture.sellerWallet,
    owner_user_id: fixture.seller.id,
    status: 'ACTIVE',
    is_for_sale: false,
    resale_price: null,
  });

  const listed = await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-listed-${rootId}`, ledger: 502 },
    eventName: 'boleto_listado',
    contractId: fixture.contractAddress,
    topics: ['boleto_listado', rootId],
    data: { version: 0, precio: 9000n },
    fallbackLedger: 502,
  });
  assert.equal(listed.status, 'processed');
  const listedTicket = await prisma.tickets.findFirstOrThrow({
    where: { contract_address: fixture.contractAddress, ticket_root_id: rootId, version: 0 },
    select: { is_for_sale: true, resale_price: true, status: true },
  });
  assert.equal(listedTicket.is_for_sale, true);
  assert.equal(String(listedTicket.resale_price), '9000');
  assert.equal(listedTicket.status, 'ACTIVE');

  const cancelled = await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-cancelled-${rootId}`, ledger: 503 },
    eventName: 'venta_cancelada',
    contractId: fixture.contractAddress,
    topics: ['venta_cancelada', rootId],
    data: { version: 0 },
    fallbackLedger: 503,
  });
  assert.equal(cancelled.status, 'processed');
  const cancelledTicket = await prisma.tickets.findFirstOrThrow({
    where: { contract_address: fixture.contractAddress, ticket_root_id: rootId, version: 0 },
    select: { is_for_sale: true, resale_price: true, lifecycle_reason: true },
  });
  assert.equal(cancelledTicket.is_for_sale, false);
  assert.equal(cancelledTicket.resale_price, null);
  assert.equal(cancelledTicket.lifecycle_reason, 'LISTING_CANCELLED');

  await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-relisted-${rootId}`, ledger: 504 },
    eventName: 'boleto_listado',
    contractId: fixture.contractAddress,
    topics: ['boleto_listado', rootId],
    data: { version: 0, precio: 12000n },
    fallbackLedger: 504,
  });
  const resaleInput = {
    evt: { txHash: `tx-sync-resale-${rootId}`, ledger: 505 },
    eventName: 'boleto_revendido',
    contractId: fixture.contractAddress,
    topics: ['boleto_revendido', rootId],
    data: {
      vendedor: fixture.sellerWallet,
      comprador: fixture.buyerWallet,
      precio: 12000n,
      version_anterior: 0,
      version_nueva: 1,
    },
    fallbackLedger: 505,
  };
  const resold = await processIndexerEvent(prisma, resaleInput);
  const replay = await processIndexerEvent(prisma, resaleInput);
  assert.equal(resold.status, 'processed');
  assert.equal(replay.status, 'skipped');

  const versions = await prisma.tickets.findMany({
    where: { contract_address: fixture.contractAddress, ticket_root_id: rootId },
    orderBy: { version: 'asc' },
    select: { version: true, owner_wallet: true, status: true, is_for_sale: true, lifecycle_reason: true },
  });
  assert.deepEqual(versions, [
    { version: 0, owner_wallet: fixture.sellerWallet, status: 'CANCELLED', is_for_sale: false, lifecycle_reason: 'RESOLD_PREVIOUS_VERSION' },
    { version: 1, owner_wallet: fixture.buyerWallet, status: 'ACTIVE', is_for_sale: false, lifecycle_reason: null },
  ]);

  await prisma.tickets.createMany({
    data: [
      {
        ticket_code: `IDX-SYNC-REDEEM-${redeemRootId}`,
        contract_address: fixture.contractAddress,
        ticket_root_id: redeemRootId,
        version: 0,
        status: 'ACTIVE',
        owner_wallet: fixture.sellerWallet,
        owner_user_id: fixture.seller.id,
      },
      {
        ticket_code: `IDX-SYNC-INVALID-${invalidatedRootId}`,
        contract_address: fixture.contractAddress,
        ticket_root_id: invalidatedRootId,
        version: 0,
        status: 'ACTIVE',
        is_for_sale: true,
        resale_price: 15000n,
        owner_wallet: fixture.sellerWallet,
        owner_user_id: fixture.seller.id,
      },
    ],
  });

  await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-redeemed-${redeemRootId}`, ledger: 506 },
    eventName: 'boleto_redimido',
    contractId: fixture.contractAddress,
    topics: ['boleto_redimido', redeemRootId],
    data: { version: 0 },
    fallbackLedger: 506,
  });
  const redeemed = await prisma.tickets.findFirstOrThrow({
    where: { contract_address: fixture.contractAddress, ticket_root_id: redeemRootId, version: 0 },
    select: { status: true, is_for_sale: true, lifecycle_reason: true, used_at: true },
  });
  assert.equal(redeemed.status, 'USED');
  assert.equal(redeemed.is_for_sale, false);
  assert.equal(redeemed.lifecycle_reason, 'REDEEMED_ONCHAIN');
  assert.ok(redeemed.used_at);

  await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-invalidated-${invalidatedRootId}`, ledger: 507 },
    eventName: 'boleto_invalidado_evt',
    contractId: fixture.contractAddress,
    topics: ['boleto_invalidado_evt', invalidatedRootId],
    data: { version: 0 },
    fallbackLedger: 507,
  });
  const invalidated = await prisma.tickets.findFirstOrThrow({
    where: { contract_address: fixture.contractAddress, ticket_root_id: invalidatedRootId, version: 0 },
    select: { status: true, is_for_sale: true, lifecycle_reason: true, resale_price: true },
  });
  assert.equal(invalidated.status, 'CANCELLED');
  assert.equal(invalidated.is_for_sale, false);
  assert.equal(invalidated.lifecycle_reason, 'INVALIDATED_ONCHAIN');
  assert.equal(String(invalidated.resale_price), '15000');

  const unknown = await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-unknown-${rootId}`, ledger: 508 },
    eventName: 'evento_desconocido_para_compatibilidad',
    contractId: fixture.contractAddress,
    topics: ['evento_desconocido_para_compatibilidad', rootId],
    data: { version: 0, raw: 'ignored' },
    fallbackLedger: 508,
  });
  assert.equal(unknown.status, 'processed');
  const afterUnknownVersions = await prisma.tickets.findMany({
    where: { contract_address: fixture.contractAddress, ticket_root_id: rootId },
    orderBy: { version: 'asc' },
    select: { version: true, owner_wallet: true, status: true, is_for_sale: true, lifecycle_reason: true },
  });
  assert.deepEqual(afterUnknownVersions, versions);

  const malformed = await processIndexerEvent(prisma, {
    evt: { txHash: `tx-sync-malformed-${rootId}`, ledger: 509 },
    eventName: 'boleto_listado',
    contractId: fixture.contractAddress,
    topics: ['boleto_listado'],
    data: { version: 0, precio: 1n },
    fallbackLedger: 509,
  });
  assert.deepEqual(malformed, { status: 'skipped', reason: 'invalid_identity' });

  const onchainEventCount = await prisma.onchain_events.count({
    where: { contract_address: fixture.contractAddress, status: 'PROCESSED' },
  });
  assert.equal(onchainEventCount, 8);
});

test('indexer integration projects boleto_redimido into USED with REDEEMED_ONCHAIN', async () => {
  const fixture = await createIndexerFixture('redeem');
  const rootId = Number(String(Date.now()).slice(-6));
  const ticket = await prisma.tickets.create({
    data: {
      ticket_code: `IDX-REDEEM-${rootId}`,
      contract_address: fixture.contractAddress,
      ticket_root_id: rootId,
      version: 0,
      status: 'ACTIVE',
      owner_wallet: fixture.sellerWallet,
      owner_user_id: fixture.seller.id,
    },
  });

  const result = await processIndexerEvent(prisma, {
    evt: { txHash: `tx-redimido-${rootId}`, ledger: 101 },
    eventName: 'boleto_redimido',
    contractId: fixture.contractAddress,
    topics: ['boleto_redimido', rootId, 1],
    data: { version: 0 },
    fallbackLedger: 101,
  });
  assert.equal(result.status, 'processed');

  const updated = await prisma.tickets.findUniqueOrThrow({
    where: { id: ticket.id },
    select: { status: true, lifecycle_reason: true, used_at: true, is_for_sale: true },
  });
  assert.equal(updated.status, 'USED');
  assert.equal(updated.lifecycle_reason, 'REDEEMED_ONCHAIN');
  assert.equal(updated.is_for_sale, false);
  assert.ok(updated.used_at);

  const event = await prisma.onchain_events.findFirstOrThrow({
    where: { tx_hash: `tx-redimido-${rootId}` },
    select: { status: true, event_name: true },
  });
  assert.equal(event.status, 'PROCESSED');
  assert.equal(event.event_name, 'boleto_redimido');
});

test('indexer integration replays boleto_revendido idempotently and authorizes NFT transfer after projection', async () => {
  const fixture = await createIndexerFixture('resale');
  const rootId = Number(String(Date.now()).slice(-6));
  const txHash = `tx-resale-${rootId}`;
  await prisma.tickets.create({
    data: {
      ticket_code: `IDX-RESALE-${rootId}`,
      contract_address: fixture.contractAddress,
      ticket_root_id: rootId,
      version: 0,
      status: 'ACTIVE',
      owner_wallet: fixture.sellerWallet,
      owner_user_id: fixture.seller.id,
      is_for_sale: true,
      resale_price: 5000n,
    },
  });

  const eventInput = {
    evt: { txHash, ledger: 202 },
    eventName: 'boleto_revendido',
    contractId: fixture.contractAddress,
    topics: ['boleto_revendido', rootId, 1],
    data: {
      vendedor: fixture.sellerWallet,
      comprador: fixture.buyerWallet,
      precio: 5000n,
      version_anterior: 0,
      version_nueva: 1,
    },
    fallbackLedger: 202,
  };

  const first = await processIndexerEvent(prisma, eventInput);
  const replay = await processIndexerEvent(prisma, eventInput);
  assert.equal(first.status, 'processed');
  assert.equal(replay.status, 'skipped');

  const versions = await prisma.tickets.findMany({
    where: { contract_address: fixture.contractAddress, ticket_root_id: rootId },
    orderBy: { version: 'asc' },
    select: { version: true, status: true, owner_wallet: true, lifecycle_reason: true, is_for_sale: true },
  });
  assert.deepEqual(versions, [
    {
      version: 0,
      status: 'CANCELLED',
      owner_wallet: fixture.sellerWallet,
      lifecycle_reason: 'RESOLD_PREVIOUS_VERSION',
      is_for_sale: false,
    },
    {
      version: 1,
      status: 'ACTIVE',
      owner_wallet: fixture.buyerWallet,
      lifecycle_reason: null,
      is_for_sale: false,
    },
  ]);

  const eventCount = await prisma.onchain_events.count({
    where: { tx_hash: txHash, event_name: 'boleto_revendido', ticket_root_id: rootId, version: 1 },
  });
  assert.equal(eventCount, 1);

  const transfer = await authorizeVerifiedNftTransfer(
    {
      userId: fixture.buyer.id,
      contractAddress: fixture.contractAddress,
      ticketRootId: rootId,
      buyerWallet: fixture.buyerWallet,
      txHash,
      expectedVersion: 1,
    },
    {
      getUserWallet: async (userId) => {
        const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
        return user?.wallet_address ?? null;
      },
      getNftContractAddress: async (contractAddress) => {
        const event = await prisma.events.findFirst({ where: { contract_address: contractAddress }, select: { nft_contract_address: true } });
        return event?.nft_contract_address ?? null;
      },
      getActiveTicketVersion: async (input) => {
        const ticket = await prisma.tickets.findFirst({
          where: {
            contract_address: input.contractAddress,
            ticket_root_id: input.ticketRootId,
            owner_wallet: input.ownerWallet,
            version: input.version,
            status: 'ACTIVE',
          },
          select: { version: true },
        });
        return ticket?.version ?? null;
      },
      getProcessedResaleEvent: async (input) => {
        const event = await prisma.onchain_events.findFirst({
          where: {
            tx_hash: input.txHash,
            contract_address: input.contractAddress,
            ticket_root_id: input.ticketRootId,
            version: input.version,
            event_name: 'boleto_revendido',
            status: 'PROCESSED',
          },
          select: { payload: true },
        });
        return event ? { payload: event.payload as any } : null;
      },
    },
  );
  assert.deepEqual(transfer, { ok: true, nftContractAddress: fixture.nftContractAddress, version: 1 });
});

test('indexer integration can retry a FAILED event once the missing previous ticket exists', async () => {
  const fixture = await createIndexerFixture('retry');
  const rootId = Number(String(Date.now()).slice(-6));
  const txHash = `tx-retry-${rootId}`;
  const eventInput = {
    evt: { txHash, ledger: 303 },
    eventName: 'boleto_revendido',
    contractId: fixture.contractAddress,
    topics: ['boleto_revendido', rootId, 1],
    data: {
      vendedor: fixture.sellerWallet,
      comprador: fixture.buyerWallet,
      precio: 7000n,
      version_anterior: 0,
      version_nueva: 1,
    },
    fallbackLedger: 303,
  };

  await assert.rejects(() => processIndexerEvent(prisma, eventInput), /No se encontro version anterior ACTIVE/);
  const failed = await prisma.onchain_events.findFirstOrThrow({
    where: { tx_hash: txHash, ticket_root_id: rootId },
    select: { status: true },
  });
  assert.equal(failed.status, 'FAILED');

  await prisma.tickets.create({
    data: {
      ticket_code: `IDX-RETRY-${rootId}`,
      contract_address: fixture.contractAddress,
      ticket_root_id: rootId,
      version: 0,
      status: 'ACTIVE',
      owner_wallet: fixture.sellerWallet,
      owner_user_id: fixture.seller.id,
      is_for_sale: true,
      resale_price: 7000n,
    },
  });

  const retried = await processIndexerEvent(prisma, eventInput);
  assert.equal(retried.status, 'processed');
  const processed = await prisma.onchain_events.findFirstOrThrow({
    where: { tx_hash: txHash, ticket_root_id: rootId },
    select: { status: true },
  });
  assert.equal(processed.status, 'PROCESSED');
});

test('indexer integration advances cursor after a processed batch', async () => {
  const fixture = await createIndexerFixture('batch');
  const rootId = Number(String(Date.now()).slice(-6));
  await prisma.indexer_state.upsert({
    where: { id: 1 },
    create: { id: 1, last_ledger: 1 },
    update: { last_ledger: 1, updated_at: new Date() },
  });
  await prisma.tickets.create({
    data: {
      ticket_code: `IDX-BATCH-${rootId}`,
      contract_address: fixture.contractAddress,
      ticket_root_id: rootId,
      version: 0,
      status: 'ACTIVE',
      owner_wallet: fixture.sellerWallet,
      owner_user_id: fixture.seller.id,
    },
  });

  const results = await processIndexerEventsBatch(prisma, [
    {
      evt: { txHash: `tx-batch-${rootId}`, ledger: 410 },
      eventName: 'boleto_redimido',
      contractId: fixture.contractAddress,
      topics: ['boleto_redimido', rootId, 1],
      data: { version: 0 },
      fallbackLedger: 410,
    },
  ], 420);

  assert.equal(results[0].status, 'processed');
  const state = await prisma.indexer_state.findUniqueOrThrow({ where: { id: 1 }, select: { last_ledger: true } });
  assert.equal(state.last_ledger, 421);
});
