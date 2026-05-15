/**
 * Deploy ticket_nft_contract (Phase 4.5) — uno por evento.
 *
 * Para cada evento PUBLISHED con contract_address (event_contract ya desplegado)
 * pero SIN nft_contract_address: deploya un ticket_nft_contract, lo inicializa
 * con el ORGANIZER_SECRET activo del backend como admin, y persiste en DB.
 *
 * Run (defaults to .env):
 *   cd backend && npx tsx scripts/deploy-nft-contracts.ts
 *
 * Redeploy NFT contracts even if the event already has one:
 *   cd backend && REDEPLOY_NFT_CONTRACTS=true npx tsx scripts/deploy-nft-contracts.ts
 *
 * Run con prod DB:
 *   cd backend && ENV_FILE=.env.prod npx tsx scripts/deploy-nft-contracts.ts
 */
import dotenv from 'dotenv';
const envFile = process.env.ENV_FILE || '.env';
dotenv.config({ path: envFile, override: true });
console.log(`[deploy-nft] env: ${envFile}`);

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Account,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const WASM_DIR = path.resolve(__dirname, '../../contracts/wasm');
const server = new SorobanRpc.Server(RPC_URL);
const REDEPLOY_NFT_CONTRACTS = process.env.REDEPLOY_NFT_CONTRACTS === 'true';

async function getAccount(publicKey: string): Promise<Account> {
  const r = await server.getAccount(publicKey);
  return new Account(r.accountId(), r.sequenceNumber());
}

async function submitTx(tx: TransactionBuilder, ...signers: Keypair[]) {
  const built = tx.build();
  const sim = await server.simulateTransaction(built);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as any).error}`);
  }
  const assembled = SorobanRpc.assembleTransaction(built, sim).build();
  for (const s of signers) assembled.sign(s);
  const send = await server.sendTransaction(assembled);
  if (send.status === 'ERROR') throw new Error(`Send failed: ${JSON.stringify(send)}`);
  let res: SorobanRpc.Api.GetTransactionResponse;
  let attempts = 0;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    res = await server.getTransaction(send.hash);
    attempts++;
  } while (res.status === 'NOT_FOUND' && attempts < 30);
  if (res.status !== 'SUCCESS') throw new Error(`Tx failed: ${res.status}`);
  return res;
}

async function uploadWasm(admin: Keypair, wasmPath: string): Promise<Buffer> {
  console.log(`Uploading WASM ${path.basename(wasmPath)}...`);
  const wasmBytes = fs.readFileSync(wasmPath);
  const account = await getAccount(admin.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm: wasmBytes }))
    .setTimeout(60);
  const result = await submitTx(tx, admin);
  const ret = (result as any).returnValue;
  if (!ret) throw new Error('No return value from upload');
  const hash = Buffer.from(ret.bytes());
  console.log(`  WASM Hash: ${hash.toString('hex')}`);
  return hash;
}

async function deployContract(admin: Keypair, wasmHash: Buffer): Promise<string> {
  const salt = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) salt[i] = Math.floor(Math.random() * 256);
  const account = await getAccount(admin.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.createCustomContract({
      address: new Address(admin.publicKey()),
      wasmHash,
      salt,
    }))
    .setTimeout(60);
  const result = await submitTx(tx, admin);
  const ret = (result as any).returnValue;
  if (!ret) throw new Error('No return value from deploy');
  return Address.fromScVal(ret).toString();
}

async function initializeNft(
  organizer: Keypair,
  contractAddress: string,
  nombre: string,
  simbolo: string,
): Promise<void> {
  const account = await getAccount(organizer.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: contractAddress,
      function: 'inicializar',
      args: [
        new Address(organizer.publicKey()).toScVal(),
        nativeToScVal(nombre, { type: 'string' }),
        nativeToScVal(simbolo, { type: 'string' }),
      ],
    }))
    .setTimeout(60);
  await submitTx(tx, organizer);
}

function deriveSymbol(slug: string): string {
  // hasta 12 chars alfanuméricos para nombre corto en Freighter
  const s = slug.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return s.slice(0, 12) || 'TICKET';
}

(async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const envDeployPath = path.resolve(__dirname, '../.env.deploy');
    const envContent = fs.readFileSync(envDeployPath, 'utf-8');
    const envVars: Record<string, string> = {};
    for (const line of envContent.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
      if (m) envVars[m[1]] = m[2].trim();
    }
    const admin = Keypair.fromSecret(envVars['ADMIN_SECRET']);
    const organizerSecret = process.env.ORGANIZER_SECRET || envVars['ORGANIZER_SECRET'];
    const organizer = Keypair.fromSecret(organizerSecret);
    console.log(`Admin:     ${admin.publicKey()}`);
    console.log(`Organizer: ${organizer.publicKey()}`);
    console.log(`Redeploy:  ${REDEPLOY_NFT_CONTRACTS ? 'yes' : 'no'}`);

    const wasmPath = path.join(WASM_DIR, 'ticket_nft_contract.wasm');
    if (!fs.existsSync(wasmPath)) throw new Error(`WASM not found: ${wasmPath}`);

    const wasmHash = await uploadWasm(admin, wasmPath);

    const events = await prisma.events.findMany({
      where: { status: 'PUBLISHED', contract_address: { not: null } },
      orderBy: { created_at: 'asc' },
    });
    console.log(`\nFound ${events.length} events with event_contract`);

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const evAny = ev as any;
      if (evAny.nft_contract_address && !REDEPLOY_NFT_CONTRACTS) {
        console.log(`[${i + 1}/${events.length}] ${ev.title} — ya tiene NFT (${evAny.nft_contract_address.slice(0, 10)}…), skip`);
        continue;
      }
      console.log(`\n--- [${i + 1}/${events.length}] ${ev.title} ---`);
      try {
        const addr = await deployContract(admin, wasmHash);
        console.log(`  Contract: ${addr}`);
        const nombre = `Boletos ${ev.title}`.slice(0, 60);
        const simbolo = deriveSymbol(ev.slug);
        await initializeNft(organizer, addr, nombre, simbolo);
        console.log(`  Inicializado (${nombre} / ${simbolo})`);
        await prisma.events.update({
          where: { id: ev.id },
          data: { nft_contract_address: addr } as any,
        });
        console.log(`  DB OK`);
      } catch (e: any) {
        console.error(`  FAILED: ${e.message}`);
      }
    }

    const done = await prisma.events.findMany({
      where: { status: 'PUBLISHED' },
      select: { title: true, nft_contract_address: true } as any,
    });
    console.log(`\n=== DONE ===`);
    for (const e of done as any[]) {
      console.log(`  ${e.title}: ${e.nft_contract_address ?? '(none)'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
