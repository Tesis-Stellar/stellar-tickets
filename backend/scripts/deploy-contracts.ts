/**
 * Deploy Soroban contracts to Stellar Testnet
 *
 * Usage: npx tsx scripts/deploy-contracts.ts
 *
 * This script:
 * 1. Generates (or reuses) admin + platform + organizer keypairs
 * 2. Funds them via Friendbot (testnet faucet)
 * 3. Uploads event_contract WASM → gets wasm hash
 * 4. Deploys one event_contract instance per event
 * 5. Initializes each contract (organizer, platform, token, commissions)
 * 6. Updates the database with contract addresses
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

const server = new SorobanRpc.Server(RPC_URL);
const prisma = new PrismaClient();

// Commissions: 5% organizer, 3% platform (out of 100 base)
const COMISION_ORGANIZADOR = 5;
const COMISION_PLATAFORMA = 3;

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

async function addVerifier(
  organizerKeypair: Keypair,
  contractAddress: string,
  verifierPubKey: string,
): Promise<void> {
  console.log(`  Adding verifier ${verifierPubKey.slice(0, 8)}...`);
  const account = await getAccount(organizerKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: contractAddress,
      function: 'agregar_verificador',
      args: [
        new Address(verifierPubKey).toScVal(),
      ],
    }))
    .setTimeout(60);

  await submitTx(tx, organizerKeypair);
  console.log(`  Verifier added!`);
}

async function main() {
  console.log('=== Soroban Contract Deployment to Testnet ===\n');

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
  const verifierKeypair = envDeployVars['VERIFIER_SECRET']
    ? Keypair.fromSecret(envDeployVars['VERIFIER_SECRET'])
    : organizerKeypair;

  console.log('Keypairs loaded from .env.deploy:');
  console.log(`  Admin:     ${adminKeypair.publicKey()}`);
  console.log(`  Platform:  ${platformKeypair.publicKey()}`);
  console.log(`  Organizer: ${organizerKeypair.publicKey()}`);
  console.log(`  Verifier:  ${verifierKeypair.publicKey()}`);

  // 2. Fund accounts via Friendbot (no-op if already funded)
  console.log('\nFunding accounts...');
  await fundAccount(adminKeypair.publicKey());
  await fundAccount(platformKeypair.publicKey());
  await fundAccount(organizerKeypair.publicKey());
  await fundAccount(verifierKeypair.publicKey());

  // 3. Upload event_contract WASM
  const eventWasmPath = path.join(WASM_DIR, 'event_contract.wasm');
  if (!fs.existsSync(eventWasmPath)) {
    throw new Error(`WASM not found: ${eventWasmPath}`);
  }
  const wasmHash = await uploadWasm(adminKeypair, eventWasmPath);

  // 4. Clear existing contract addresses and redeploy all PUBLISHED events
  await prisma.events.updateMany({
    where: { status: 'PUBLISHED' },
    data: { contract_address: null },
  });
  const events = await prisma.events.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { created_at: 'asc' },
  });

  console.log(`\nFound ${events.length} events without contracts`);

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
      await addVerifier(organizerKeypair, contractAddress, verifierKeypair.publicKey());

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
