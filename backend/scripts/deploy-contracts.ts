/**
 * Deploy Soroban contracts to Stellar Testnet
 *
 * Usage: npx tsx scripts/deploy-contracts.ts
 *
 * This script:
 * 1. Generates (or reuses) admin + platform + organizer keypairs
 * 2. Funds them via Friendbot (testnet faucet)
 * 3. Uploads event_contract WASM → gets wasm hash
 * 4. Deploys one event_contract instance per target event
 * 5. Initializes each contract (organizer, platform, token, commissions)
 * 6. Updates only the target event with its contract address
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Account,
  xdr,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const WASM_DIR = path.resolve(__dirname, '../../contracts/wasm');
const CONTRACTS_DIR = path.resolve(__dirname, '../../contracts');

const server = new SorobanRpc.Server(RPC_URL);
const prisma = new PrismaClient();

// Commissions: 5% organizer, 3% platform (out of 100 base)
const COMISION_ORGANIZADOR = 5;
const COMISION_PLATAFORMA = 3;

function resolveWasmPath(contractName: string, candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `${contractName} WASM not found. Checked:\n${candidates.map((candidate) => `  - ${candidate}`).join('\n')}\n` +
    `Build the contract first or copy the WASM to ${WASM_DIR}.`,
  );
}

async function fundAccount(publicKey: string): Promise<void> {
  console.log(`  Funding ${publicKey.slice(0, 8)}...`);
  const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (!response.ok) {
    const text = await response.text();
    // Already funded is OK
    if (!text.includes('createAccountAlreadyExist') && !text.includes('rate limit')) {
      console.warn(`  Friendbot warning: ${text}`);
    }
    console.log('  (already funded)');
  }
}

async function getAccount(publicKey: string): Promise<Account> {
  const accountResponse = await server.getAccount(publicKey);
  return new Account(accountResponse.accountId(), accountResponse.sequenceNumber());
}

async function submitTx(tx: TransactionBuilder, ...signers: Keypair[]): Promise<SorobanRpc.Api.GetTransactionResponse> {
  let built = tx.build();

  // Simulate first
  const simResponse = await server.simulateTransaction(built);
  if (SorobanRpc.Api.isSimulationError(simResponse)) {
    throw new Error(`Simulation failed: ${(simResponse as any).error}`);
  }

  // Assemble with resource estimates
  const assembled = SorobanRpc.assembleTransaction(built, simResponse).build();
  for (const signer of signers) {
    assembled.sign(signer);
  }

  const sendResponse = await server.sendTransaction(assembled);
  if (sendResponse.status === 'ERROR') {
    throw new Error(`Send failed: ${JSON.stringify(sendResponse)}`);
  }

  // Poll for result
  let getResponse: SorobanRpc.Api.GetTransactionResponse;
  let attempts = 0;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    getResponse = await server.getTransaction(sendResponse.hash);
    attempts++;
  } while (getResponse.status === 'NOT_FOUND' && attempts < 30);

  if (getResponse.status !== 'SUCCESS') {
    throw new Error(`Transaction failed: ${getResponse.status}`);
  }

  return getResponse;
}

async function uploadWasm(adminKeypair: Keypair, wasmPath: string): Promise<Buffer> {
  console.log(`\n📦 Uploading WASM: ${path.basename(wasmPath)}`);
  const wasmBytes = fs.readFileSync(wasmPath);

  const account = await getAccount(adminKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: '10000000', // 1 XLM max fee for WASM upload
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.uploadContractWasm({ wasm: wasmBytes }))
    .setTimeout(60);

  const result = await submitTx(tx, adminKeypair);

  // Extract wasm hash from result
  const returnValue = (result as any).returnValue;
  if (!returnValue) throw new Error('No return value from WASM upload');
  const wasmHash = returnValue.bytes();
  console.log(`  WASM Hash: ${Buffer.from(wasmHash).toString('hex')}`);
  return Buffer.from(wasmHash);
}

async function deployContract(adminKeypair: Keypair, wasmHash: Buffer, salt: Buffer): Promise<string> {
  const account = await getAccount(adminKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.createCustomContract({
      address: new Address(adminKeypair.publicKey()),
      wasmHash: wasmHash,
      salt: salt,
    }))
    .setTimeout(60);

  const result = await submitTx(tx, adminKeypair);

  const returnValue = (result as any).returnValue;
  if (!returnValue) throw new Error('No return value from contract deploy');
  const contractAddress = Address.fromScVal(returnValue).toString();
  console.log(`  Contract: ${contractAddress}`);
  return contractAddress;
}

async function initializeEventContract(
  adminKeypair: Keypair,
  organizerKeypair: Keypair,
  contractAddress: string,
  platformPubKey: string,
): Promise<void> {
  console.log(`  Initializing contract ${contractAddress.slice(0, 8)}...`);
  // Use organizer as source account since inicializar() requires organizador.require_auth()
  const account = await getAccount(organizerKeypair.publicKey());

  // Use the native XLM asset as payment token for testnet demo
  const nativeTokenAddress = new Address('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC');

  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: contractAddress,
      function: 'inicializar',
      args: [
        new Address(organizerKeypair.publicKey()).toScVal(),  // organizador
        new Address(platformPubKey).toScVal(),                // plataforma
        nativeTokenAddress.toScVal(),                         // token_pago
        nativeToScVal(COMISION_ORGANIZADOR, { type: 'i128' }),  // comision_organizador
        nativeToScVal(COMISION_PLATAFORMA, { type: 'i128' }),   // comision_plataforma
      ],
    }))
    .setTimeout(60);

  await submitTx(tx, organizerKeypair);
  console.log(`  Initialized!`);
}

async function main() {
  console.log('=== Soroban Contract Deployment to Testnet ===\n');
  const deployEventId = process.env.DEPLOY_EVENT_ID?.trim();

  // 1. Load keys from .env.deploy (pre-configured wallets)
  const envDeployPath = path.resolve(__dirname, '../.env.deploy');
  const envDeployContent = fs.readFileSync(envDeployPath, 'utf-8');
  const envDeployVars: Record<string, string> = {};
  for (const line of envDeployContent.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (match) envDeployVars[match[1]] = match[2].trim();
  }

  const adminKeypair = Keypair.fromSecret(envDeployVars['ADMIN_SECRET']);
  const platformKeypair = Keypair.fromSecret(envDeployVars['PLATFORM_SECRET']);
  const organizerKeypair = Keypair.fromSecret(envDeployVars['ORGANIZER_SECRET']);

  console.log('Keypairs loaded from .env.deploy:');
  console.log(`  Admin:     ${adminKeypair.publicKey()}`);
  console.log(`  Platform:  ${platformKeypair.publicKey()}`);
  console.log(`  Organizer: ${organizerKeypair.publicKey()}`);

  // 2. Fund accounts via Friendbot (no-op if already funded)
  console.log('\nFunding accounts...');
  await fundAccount(adminKeypair.publicKey());
  await fundAccount(platformKeypair.publicKey());
  await fundAccount(organizerKeypair.publicKey());

  // 3. Upload event_contract WASM
  const eventWasmPath = resolveWasmPath('event_contract', [
    path.join(WASM_DIR, 'event_contract.wasm'),
    path.join(CONTRACTS_DIR, 'target/wasm32v1-none/release/event_contract.wasm'),
    path.join(CONTRACTS_DIR, 'target/wasm32-unknown-unknown/release/event_contract.optimized.wasm'),
    path.join(CONTRACTS_DIR, 'target/wasm32-unknown-unknown/release/event_contract.wasm'),
  ]);
  const wasmHash = await uploadWasm(adminKeypair, eventWasmPath);

  // 4. Deploy only the requested event when invoked from admin. Never clear
  // contracts already attached to other events; tickets may already reference them.
  const events = await prisma.events.findMany({
    where: {
      status: 'PUBLISHED',
      ...(deployEventId ? { id: deployEventId, contract_address: null } : { contract_address: null }),
    },
    orderBy: { created_at: 'asc' },
  });

  if (deployEventId && events.length === 0) {
    throw new Error(`No deployable PUBLISHED event without contract found for DEPLOY_EVENT_ID=${deployEventId}`);
  }

  console.log(`\nFound ${events.length} deployable event(s) without contracts`);

  // 5. Deploy and initialize one contract per event
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    console.log(`\n--- [${i + 1}/${events.length}] ${event.title} ---`);

    // Use random salt so re-deploys (with new WASM) don't collide with existing addresses
    const salt = Buffer.alloc(32);
    for (let b = 0; b < 32; b++) salt[b] = Math.floor(Math.random() * 256);

    try {
      const contractAddress = await deployContract(adminKeypair, wasmHash, salt);

      // Initialize the contract
      await initializeEventContract(
        adminKeypair,
        organizerKeypair,
        contractAddress,
        platformKeypair.publicKey(),
      );

      // Update DB
      await prisma.events.update({
        where: { id: event.id },
        data: { contract_address: contractAddress },
      });
      console.log(`  DB updated!`);
    } catch (error: any) {
      console.error(`  FAILED: ${error.message}`);
    }
  }

  // 6. Summary
  const deployed = await prisma.events.findMany({
    where: { contract_address: { not: null } },
    select: { title: true, contract_address: true },
  });

  console.log('\n=== DEPLOYMENT SUMMARY ===');
  console.log(`Deployed: ${deployed.length}/${events.length} contracts`);
  for (const e of deployed) {
    console.log(`  ${e.title}: ${e.contract_address}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
