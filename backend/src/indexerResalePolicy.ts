export type TicketVersionIdentity = {
  contract_address: string;
  ticket_root_id: number;
  version: number;
};

export type PreviousTicketForResale = {
  order_item_id: string | null;
  status: string;
};

export function resolveResaleVersions(
  data: { version_anterior?: unknown; version_nueva?: unknown },
  fallbackVersion: number,
) {
  const newVersion = Number(data.version_nueva ?? fallbackVersion);
  const previousVersion = Number(data.version_anterior ?? newVersion - 1);

  if (!Number.isFinite(newVersion) || !Number.isFinite(previousVersion)) {
    throw new Error('Evento boleto_revendido sin versiones validas');
  }

  return { previousVersion, newVersion };
}

export function buildTicketVersionIdentity(
  contractId: string,
  rootId: number,
  version: number,
): TicketVersionIdentity {
  return {
    contract_address: contractId,
    ticket_root_id: rootId,
    version,
  };
}

export function assertActivePreviousVersion(
  ticket: PreviousTicketForResale | null,
  rootId: number,
  previousVersion: number,
): asserts ticket is PreviousTicketForResale {
  if (!ticket || ticket.status !== 'ACTIVE') {
    throw new Error(`No se encontro version anterior ACTIVE para reventa root_id=${rootId} v${previousVersion}`);
  }
}
