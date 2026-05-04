/**
 * One-time setup: enables AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED on the organizer
 * account so collectible assets can be transferred from seller to buyer on P2P
 * resale via clawback (without requiring the seller's signature).
 *
 * Run once after wallet rotation:
 *   node --import tsx scripts/setup-issuer-flags.ts
 */
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Horizon,
  AuthClawbackEnabledFlag,
  AuthRevocableFlag,
} from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
dotenv.config();

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const horizon = new Horizon.Server(HORIZON_URL);

async function main() {
  const secret = process.env.ORGANIZER_SECRET;
  if (!secret) throw new Error('ORGANIZER_SECRET missing in env');
  const kp = Keypair.fromSecret(secret);
  console.log('Issuer:', kp.publicKey());

  const account = await horizon.loadAccount(kp.publicKey());
  const currentFlags = account.flags;
  console.log('Current flags:', currentFlags);

  if (currentFlags.auth_revocable && currentFlags.auth_clawback_enabled) {
    console.log('✅ Flags already set');
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({
      setFlags: (AuthRevocableFlag | AuthClawbackEnabledFlag) as any,
    }))
    .setTimeout(60)
    .build();

  tx.sign(kp);
  const res = await horizon.submitTransaction(tx);
  console.log('✅ Flags updated. tx:', (res as any).hash);
}

main().catch(e => { console.error(e?.response?.data ?? e); process.exit(1); });
