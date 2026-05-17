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
