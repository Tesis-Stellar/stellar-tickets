export type DeployEventSnapshot = {
  id: string;
  contract_address?: string | null;
};

export type DeployEventDecision =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

export function authorizeSingleEventDeploy(input: {
  event: DeployEventSnapshot | null;
  soldTicketsCount: number;
}): DeployEventDecision {
  if (!input.event) {
    return { ok: false, status: 404, error: 'Evento no encontrado' };
  }

  if (input.event.contract_address) {
    return { ok: false, status: 409, error: 'El evento ya tiene contrato' };
  }

  if (input.soldTicketsCount > 0) {
    return { ok: false, status: 409, error: 'No se puede desplegar contrato para un evento con tickets emitidos' };
  }

  return { ok: true };
}
