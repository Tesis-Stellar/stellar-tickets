/**
 * One-time setup: sets home_domain on the organizer (issuer) account so wallets
 * (Freighter, Lobstr) can fetch asset metadata + icon from
 *   https://<HOME_DOMAIN>/.well-known/stellar.toml
 *
 * Required env: ORGANIZER_SECRET, ISSUER_HOME_DOMAIN (e.g. "stellar-tickets-backend.vercel.app")
 *
 * Run:
 *   ISSUER_HOME_DOMAIN=tu-backend.vercel.app node --import tsx scripts/setup-issuer-home-domain.ts
 */
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Horizon,
} from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
dotenv.config();

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const horizon = new Horizon.Server(HORIZON_URL);

async function main() {
  const secret = process.env.ORGANIZER_SECRET;
  const homeDomain = process.env.ISSUER_HOME_DOMAIN;
  if (!secret) throw new Error('ORGANIZER_SECRET missing in env');
  if (!homeDomain) throw new Error('ISSUER_HOME_DOMAIN missing (e.g. stellar-tickets-backend.vercel.app — without https://)');

  const kp = Keypair.fromSecret(secret);
  console.log('Issuer:', kp.publicKey());
  console.log('Setting home_domain ->', homeDomain);

  const account = await horizon.loadAccount(kp.publicKey());
  if ((account as any).home_domain === homeDomain) {
    console.log('✅ home_domain already set to', homeDomain);
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ homeDomain }))
    .setTimeout(60)
    .build();

  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  console.log('✅ home_domain updated. tx:', (res as any).hash);
  console.log('\nVerify the toml is reachable at:');
  console.log(`  https://${homeDomain}/.well-known/stellar.toml`);
}

main().catch(e => { console.error(e?.response?.data ?? e); process.exit(1); });
