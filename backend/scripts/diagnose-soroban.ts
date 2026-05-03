import { Keypair, Networks, TransactionBuilder, Operation, Account, nativeToScVal } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import dotenv from 'dotenv';
dotenv.config();

const RPC_URL = 'https://soroban-testnet.stellar.org';
const server = new SorobanRpc.Server(RPC_URL);

// Contract from Railway's DB (Festival Urbano - most recent)
const TEST_CONTRACT = 'CAZI4NCEZNU4WBK5MC4CUH7TKUSUCO75NLVI7RFK6MPHJX36ZEMFZ6MR';

async function diagnose() {
  const secret = process.env.ORGANIZER_SECRET;
  if (!secret) { console.error('❌ No ORGANIZER_SECRET in .env'); process.exit(1); }

  const kp = Keypair.fromSecret(secret);
  console.log('🔑 Organizer public key:', kp.publicKey());

  // 1. Check account balance
  try {
    const acc = await server.getAccount(kp.publicKey());
    console.log('✅ Account found on Testnet. Sequence:', acc.sequenceNumber());
  } catch (e: any) {
    console.error('❌ Account NOT found on Testnet:', e.message);
    console.log('→ Fund it at: https://friendbot.stellar.org/?addr=' + kp.publicKey());
    process.exit(1);
  }

  // 2. Try to simulate crear_boleto
  console.log('\n🔬 Simulating crear_boleto on contract:', TEST_CONTRACT.slice(0, 8) + '...');
  try {
    const accountResponse = await server.getAccount(kp.publicKey());
    const account = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

    const tx = new TransactionBuilder(account, {
      fee: '10000000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: TEST_CONTRACT,
        function: 'crear_boleto',
        args: [
          nativeToScVal(1, { type: 'u32' }),
          nativeToScVal(90000, { type: 'i128' }),
        ],
      }))
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      console.error('❌ Simulation FAILED:');
      console.error((sim as any).error);
    } else {
      console.log('✅ Simulation SUCCESS!');
      console.log('   Cost:', (sim as any).cost ?? 'n/a');
    }
  } catch (e: any) {
    console.error('❌ Error during simulation:', e.message);
  }
}

diagnose().catch(console.error);
