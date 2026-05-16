import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const QR_TOKEN_TYPE = 'secure-ticket.qr.v1';
export const QR_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export type TicketQrClaims = {
  typ: typeof QR_TOKEN_TYPE;
  contractAddress: string;
  ticketRootId: number;
  version: number;
  eventId: string;
  ownerWallet?: string | null;
  exp: number;
  nonce: string;
};

export type VerifiedTicketQr =
  | { ok: true; claims: TicketQrClaims }
  | { ok: false; status: 400 | 409; error: string };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64urlJson<T>(input: string): T {
  return JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) as T;
}

function signPayload(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidClaims(value: Partial<TicketQrClaims>): value is TicketQrClaims {
  return (
    value.typ === QR_TOKEN_TYPE &&
    isNonEmptyString(value.contractAddress) &&
    typeof value.ticketRootId === 'number' &&
    Number.isInteger(value.ticketRootId) &&
    value.ticketRootId >= 0 &&
    typeof value.version === 'number' &&
    Number.isInteger(value.version) &&
    value.version >= 0 &&
    isNonEmptyString(value.eventId) &&
    (value.ownerWallet == null || isNonEmptyString(value.ownerWallet)) &&
    typeof value.exp === 'number' &&
    Number.isInteger(value.exp) &&
    value.exp > 0 &&
    isNonEmptyString(value.nonce)
  );
}

export function signTicketQr(input: {
  secret: string;
  contractAddress: string;
  ticketRootId: number;
  version: number;
  eventId: string;
  ownerWallet?: string | null;
  now?: Date;
  ttlSeconds?: number;
  nonce?: string;
}): string {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: TicketQrClaims = {
    typ: QR_TOKEN_TYPE,
    contractAddress: input.contractAddress,
    ticketRootId: input.ticketRootId,
    version: input.version,
    eventId: input.eventId,
    ownerWallet: input.ownerWallet ?? null,
    exp: nowSeconds + (input.ttlSeconds ?? QR_TOKEN_TTL_SECONDS),
    nonce: input.nonce ?? randomBytes(16).toString('base64url'),
  };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = signPayload(input.secret, signingInput);
  return `${signingInput}.${signature}`;
}

export function verifyTicketQr(input: {
  token: string;
  secret: string;
  now?: Date;
}): VerifiedTicketQr {
  const parts = input.token.split('.');
  if (parts.length !== 3) {
    return { ok: false, status: 400, error: 'QR firmado invalido' };
  }

  const [headerRaw, payloadRaw, signature] = parts;
  const signingInput = `${headerRaw}.${payloadRaw}`;
  const expected = signPayload(input.secret, signingInput);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, status: 400, error: 'Firma de QR invalida' };
  }

  try {
    const header = decodeBase64urlJson<{ alg?: string; typ?: string }>(headerRaw);
    if (header.alg !== 'HS256') {
      return { ok: false, status: 400, error: 'Firma de QR invalida' };
    }

    const claims = decodeBase64urlJson<Partial<TicketQrClaims>>(payloadRaw);
    if (!isValidClaims(claims)) {
      return { ok: false, status: 400, error: 'Payload de QR invalido' };
    }

    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (claims.exp <= nowSeconds) {
      return { ok: false, status: 409, error: 'QR expirado' };
    }

    return { ok: true, claims };
  } catch {
    return { ok: false, status: 400, error: 'Payload de QR invalido' };
  }
}
