export type ScannerRequestBody =
  | { qrToken: string }
  | { contractAddress: string; ticketRootId: number; version?: number }
  | { ticketId: string };

export type ParsedScannerPayload = {
  body: ScannerRequestBody;
  label: string;
};

export function parseScannerPayload(rawValue: string): ParsedScannerPayload {
  const payload = JSON.parse(rawValue);

  if (payload.qrToken) {
    return {
      body: { qrToken: payload.qrToken },
      label: "QR firmado",
    };
  }

  if (payload.contractAddress && payload.ticketRootId != null) {
    return {
      body: {
        contractAddress: payload.contractAddress,
        ticketRootId: payload.ticketRootId,
        ...(payload.version != null ? { version: payload.version } : {}),
      },
      label: `${payload.contractAddress.slice(0, 6)}.../#${payload.ticketRootId}${payload.version != null ? `v${payload.version}` : ""}`,
    };
  }

  if (payload.ticketId) {
    return {
      body: { ticketId: payload.ticketId },
      label: payload.code || payload.ticketId.slice(0, 8),
    };
  }

  throw new Error("QR No Reconocido");
}
