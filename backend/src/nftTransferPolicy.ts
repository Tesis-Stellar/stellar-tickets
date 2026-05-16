type ResaleEventPayload = {
  value?: {
    comprador?: unknown;
    version_nueva?: unknown;
  };
  comprador?: unknown;
  version_nueva?: unknown;
};

export type NftTransferRequest = {
  userId: string;
  contractAddress: string;
  ticketRootId: number;
  buyerWallet: string;
  txHash: string;
  expectedVersion: number;
};

export type NftTransferPolicyDeps = {
  getUserWallet: (userId: string) => Promise<string | null>;
  getNftContractAddress: (contractAddress: string) => Promise<string | null>;
  getActiveTicketVersion: (input: {
    contractAddress: string;
    ticketRootId: number;
    ownerWallet: string;
    version: number;
  }) => Promise<number | null>;
  getProcessedResaleEvent: (input: {
    txHash: string;
    contractAddress: string;
    ticketRootId: number;
    version: number;
  }) => Promise<{ payload: ResaleEventPayload | null } | null>;
};

export type NftTransferPolicyResult =
  | { ok: true; nftContractAddress: string; version: number }
  | { ok: false; status: 400 | 403 | 409; error: string };

export async function authorizeVerifiedNftTransfer(
  request: NftTransferRequest,
  deps: NftTransferPolicyDeps,
): Promise<NftTransferPolicyResult> {
  if (!request.contractAddress || request.ticketRootId == null || !request.buyerWallet || !request.txHash || request.expectedVersion == null) {
    return {
      ok: false,
      status: 400,
      error: 'contractAddress, ticketRootId, buyerWallet, txHash y expectedVersion son requeridos',
    };
  }

  const userWallet = await deps.getUserWallet(request.userId);
  if (!userWallet || userWallet !== request.buyerWallet) {
    return {
      ok: false,
      status: 403,
      error: 'buyerWallet no coincide con la wallet vinculada al usuario',
    };
  }

  const nftContractAddress = await deps.getNftContractAddress(request.contractAddress);
  if (!nftContractAddress) {
    return {
      ok: false,
      status: 400,
      error: 'Evento sin nft_contract_address (NFT no desplegado)',
    };
  }

  const activeVersion = await deps.getActiveTicketVersion({
    contractAddress: request.contractAddress,
    ticketRootId: request.ticketRootId,
    ownerWallet: request.buyerWallet,
    version: request.expectedVersion,
  });
  if (activeVersion === null) {
    return {
      ok: false,
      status: 409,
      error: 'Reventa no confirmada: el indexer aun no proyecta al comprador como dueño activo',
    };
  }

  const resaleEvent = await deps.getProcessedResaleEvent({
    txHash: request.txHash,
    contractAddress: request.contractAddress,
    ticketRootId: request.ticketRootId,
    version: activeVersion,
  });
  const payload = resaleEvent?.payload;
  const indexedBuyer = payload?.value?.comprador ?? payload?.comprador;
  const indexedVersion = payload?.value?.version_nueva ?? payload?.version_nueva;

  if (!resaleEvent || String(indexedBuyer) !== request.buyerWallet || Number(indexedVersion) !== activeVersion) {
    return {
      ok: false,
      status: 409,
      error: 'Transferencia bloqueada: no existe boleto_revendido confirmado para ese txHash, comprador y version',
    };
  }

  return { ok: true, nftContractAddress, version: activeVersion };
}
