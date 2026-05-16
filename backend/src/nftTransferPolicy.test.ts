import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeVerifiedNftTransfer, type NftTransferPolicyDeps, type NftTransferRequest } from './nftTransferPolicy';

const baseRequest: NftTransferRequest = {
  userId: 'user-buyer',
  contractAddress: 'CONTRACT_EVENT',
  ticketRootId: 42,
  buyerWallet: 'GBUYER',
  txHash: 'tx-resale-ok',
  expectedVersion: 2,
};

const baseDeps: NftTransferPolicyDeps = {
  getUserWallet: async () => 'GBUYER',
  getNftContractAddress: async () => 'CNFT',
  getActiveTicketVersion: async () => 2,
  getProcessedResaleEvent: async () => ({
    payload: {
      value: {
        comprador: 'GBUYER',
        version_nueva: 2,
      },
    },
  }),
};

test('rejects a user trying to transfer an NFT to a wallet they do not own', async () => {
  const result = await authorizeVerifiedNftTransfer(baseRequest, {
    ...baseDeps,
    getUserWallet: async () => 'GOTHER',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: 'buyerWallet no coincide con la wallet vinculada al usuario',
  });
});

test('rejects transfer when the buyer is not the active owner of the expected version', async () => {
  const result = await authorizeVerifiedNftTransfer(baseRequest, {
    ...baseDeps,
    getActiveTicketVersion: async () => null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.error, /Reventa no confirmada/);
  }
});

test('rejects transfer without a processed boleto_revendido for the txHash and version', async () => {
  const result = await authorizeVerifiedNftTransfer(baseRequest, {
    ...baseDeps,
    getProcessedResaleEvent: async () => null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.error, /boleto_revendido confirmado/);
  }
});

test('authorizes transfer only when wallet, active version and resale event match', async () => {
  const result = await authorizeVerifiedNftTransfer(baseRequest, baseDeps);

  assert.deepEqual(result, {
    ok: true,
    nftContractAddress: 'CNFT',
    version: 2,
  });
});
