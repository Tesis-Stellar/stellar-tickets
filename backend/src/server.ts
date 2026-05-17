import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  FeeBumpTransaction,
  Operation,
  Account,
  Address,
  Asset,
  Horizon,
  nativeToScVal,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { runIndexer } from './indexer';
import { authorizeVerifiedNftTransfer } from './nftTransferPolicy';
import { authorizeScannerRole, evaluateScanTicket, parseScanRequest } from './scannerPolicy';
import { buildCheckinPayloadSummary, summarizeScanRequest, type CheckinResult } from './checkinPolicy';
import { buildSimulatedOrderNumber, normalizeIdempotencyKey } from './checkoutPolicy';
import { deriveChainEventId, parseSorobanU32ReturnValue } from './secureTicketPolicy';
import { createWalletChallenge, verifyWalletChallengeSignature } from './walletChallengePolicy';
import { signTicketQr } from './qrPolicy';
import { authorizeTransactionIntentCurrentState, authorizeTransactionIntentSubmit, buildTransactionIntentExpiry } from './transactionIntentPolicy';
import { authorizeSingleEventDeploy } from './deployEventPolicy';
import { codeForStatus, requestIdMiddleware, sendApiError } from './apiError';
import { evaluateRateLimit, isCorsOriginAllowed, isJwtSecretStrong, parseCorsOrigins, type RateLimitBucket } from './securityPolicy';
import { buildSeatHoldExpiration, isSeatReservable } from './seatHoldPolicy';
import { defaultResalePolicy, evaluateResalePolicy, type ResalePolicyInput } from './resalePolicy';
import { canUserAccessClaim, isInternalClaimRole, isPqrClaimStatus, isPqrClaimType } from './claimPolicy';
import { exec } from 'child_process';
import util from 'util';
import QRCode from 'qrcode';

const execPromise = util.promisify(exec);

dotenv.config();

// BigInt fields (e.g. cities.id) are not JSON-serializable by default
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const configuredJwtSecret = process.env.JWT_SECRET;

if (!configuredJwtSecret && isProduction) {
  throw new Error('Missing required environment variable: JWT_SECRET');
}
if (isProduction && !isJwtSecretStrong(configuredJwtSecret)) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}

const EFFECTIVE_JWT_SECRET = configuredJwtSecret || 'stellar-tickets-dev-secret-change-in-prod';
if (!configuredJwtSecret) {
  console.warn('[WARN] JWT_SECRET is not set. Using insecure development fallback; do not use this in shared, demo, or production environments.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || (isProduction ? '2h' : '7d');
const QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || EFFECTIVE_JWT_SECRET;
const ALLOW_LEGACY_TICKET_ID_SCAN = process.env.ALLOW_LEGACY_TICKET_ID_SCAN === 'true';
const configuredCorsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const developmentCorsOrigins = ['http://localhost:5173', 'http://localhost:8080', 'http://localhost:3000'];
const CORS_ORIGINS = Array.from(new Set([
  ...configuredCorsOrigins,
  ...(!isProduction ? developmentCorsOrigins : []),
]));

// Soroban / Stellar config
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);
const horizonServer = new Horizon.Server(HORIZON_URL);

// Organizer keypair for on-chain operations (from deploy)
const ORGANIZER_SECRET = process.env.ORGANIZER_SECRET;
const organizerKeypair = ORGANIZER_SECRET ? Keypair.fromSecret(ORGANIZER_SECRET) : null;

// ── Soroban helpers for ticket_nft_contract (Phase 4.5) ─────────────────────
async function invokeSoroban(
  signer: Keypair,
  contract: string,
  fnName: string,
  args: xdr.ScVal[],
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  let accResp: Awaited<ReturnType<typeof sorobanServer.getAccount>>;
  try {
    accResp = await sorobanServer.getAccount(signer.publicKey());
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (message.includes('Account not found')) {
      throw new Error(`Cuenta ORGANIZER_SECRET no existe o no esta fondeada en testnet: ${signer.publicKey()}`);
    }
    throw error;
  }
  const account = new Account(accResp.accountId(), accResp.sequenceNumber());
  const tx = new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeContractFunction({ contract, function: fnName, args }))
    .setTimeout(60)
    .build();
  const sim = await sorobanServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Soroban sim failed: ${(sim as any).error}`);
  }
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  assembled.sign(signer);
  const send = await sorobanServer.sendTransaction(assembled);
  if (send.status === 'ERROR') throw new Error(`Soroban send failed: ${JSON.stringify(send)}`);
  let res: SorobanRpc.Api.GetTransactionResponse;
  let attempts = 0;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    res = await sorobanServer.getTransaction(send.hash);
    attempts++;
  } while (res.status === 'NOT_FOUND' && attempts < 30);
  if (res.status !== 'SUCCESS') {
    let diagnostics = '';
    try {
      diagnostics = JSON.stringify((res as any).diagnosticEvents ?? (res as any).resultXdr ?? '');
    } catch {
      diagnostics = '';
    }
    throw new Error(`Soroban tx failed: ${res.status}${diagnostics ? ` diagnostics=${diagnostics.slice(0, 500)}` : ''}`);
  }
  return res;
}

/**
 * Generates a deterministic Stellar classic asset code (alphanum12) from a
 * ticket UUID. Format: 'T' + first 11 hex chars of UUID, uppercased.
 * Example: 'e9e63590-589d-...' -> 'TE9E635905889'
 */
function ticketAssetCode(ticketId: string): string {
  const hex = ticketId.replace(/-/g, '').slice(0, 11).toUpperCase();
  return `T${hex}`;
}

// Helper: build user DTO for frontend
function toUserDto(user: { id: string; first_name: string; last_name: string; email: string; phone: string | null; document_type: string; document_number: string; wallet_address?: string | null; role?: string }) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone || '',
    documentType: user.document_type,
    documentNumber: user.document_number,
    walletAddress: user.wallet_address ?? null,
    role: user.role || 'CUSTOMER',
  };
}

// Auth middleware: extracts user from JWT
async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    sendApiError(req, res, 401, 'UNAUTHORIZED', 'Token requerido');
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), EFFECTIVE_JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    const user = await cached(`auth:user:${payload.userId}`, 30_000, () =>
      prisma.users.findUnique({
        where: { id: payload.userId },
        select: { id: true, role: true, is_active: true },
      })
    );
    if (user && !user.is_active) {
      sendApiError(req, res, 403, 'USER_INACTIVE', 'Usuario inactivo');
      return;
    }
    (req as any).authUser = user;
    next();
  } catch {
    sendApiError(req, res, 401, 'UNAUTHORIZED', 'Token inválido o expirado');
  }
}

function requireCustomerRole(req: Request, res: Response): boolean {
  const role = (req as any).authUser?.role;
  if (role !== 'CUSTOMER') {
    sendApiError(req, res, 403, 'FORBIDDEN', 'Las cuentas operativas no pueden comprar boletos');
    return false;
  }
  return true;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function rateLimit(options: { key: string; windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const identity = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const bucketKey = `${options.key}:${identity}`;
    const decision = evaluateRateLimit({
      bucket: rateLimitBuckets.get(bucketKey),
      now: Date.now(),
      windowMs: options.windowMs,
      max: options.max,
    });
    rateLimitBuckets.set(bucketKey, decision.bucket);
    if (!decision.allowed) {
      res.setHeader('Retry-After', String(decision.retryAfterSeconds));
      sendApiError(req, res, 429, 'RATE_LIMITED', 'Demasiadas solicitudes, intenta de nuevo mas tarde');
      return;
    }
    next();
  };
}

const authRateLimit = rateLimit({ key: 'auth', windowMs: 60_000, max: 20 });
const scannerRateLimit = rateLimit({ key: 'scanner', windowMs: 60_000, max: 60 });
const transactionRateLimit = rateLimit({ key: 'transactions', windowMs: 60_000, max: 30 });
const walletRateLimit = rateLimit({ key: 'wallet', windowMs: 60_000, max: 20 });

app.use(requestIdMiddleware);
app.use(cors({
  origin(origin, callback) {
    if (isCorsOriginAllowed(origin, CORS_ORIGINS)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin not allowed'));
  },
}));
app.use(express.json({ limit: '8mb' }));

// ── In-memory cache (avoids repeated Supabase round-trips ~150ms each) ──
const cache = new Map<string, { data?: any; promise?: Promise<any>; expires: number }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) {
    if (hit.promise) return hit.promise as Promise<T>;
    return Promise.resolve(hit.data as T);
  }
  const promise = fn()
    .then((data) => {
      cache.set(key, { data, expires: Date.now() + ttlMs });
      return data;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  return promise;
}
function invalidateCache(prefix?: string) {
  if (!prefix) { cache.clear(); return; }
  for (const key of cache.keys()) { if (key.startsWith(prefix)) cache.delete(key); }
}

async function recordCheckin(input: {
  verifierUserId: string;
  ticketId?: string | null;
  result: CheckinResult;
  reason?: string;
  payload?: Record<string, unknown>;
}) {
  return prisma.checkins.create({
    data: {
      verifier_user_id: input.verifierUserId,
      ticket_id: input.ticketId ?? null,
      result: input.result,
      source: 'db',
      reason: input.reason ?? null,
      payload: input.payload as any,
    },
  });
}

// ── Stellar TOML + QR collectible images ────────────────────────────────────
//    Wallets (Freighter, Lobstr) fetch /.well-known/stellar.toml from the
//    issuer's home_domain to render NFT metadata. Each ticket's `image` field
//    points at /api/tickets/qr/<assetCode>.png so the collectible Freighter
//    shows IS the QR a verifier scans at the door.
//
//    For Freighter to classify the asset as "Collectible" (not generic token):
//      - supply = 1 (we mint exactly 1 unit per ticket)
//      - is_asset_anchored = false
//      - fixed_number = 1
//      - image = stable URL returning a PNG
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || 'https://stellar-ticket.vercel.app';

// Memoize generated QR PNGs in-process. The QR payload is deterministic per
// asset_code (contract_address + ticket_root_id are immutable across versions),
// so a buffer cache hit costs ~0ms vs ~10ms regeneration.
const qrCache = new Map<string, Buffer>();

async function buildTicketQrPng(payload: object): Promise<Buffer> {
  return QRCode.toBuffer(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: 512,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

function buildSignedTicketQrPayload(input: {
  contractAddress: string;
  ticketRootId: number;
  version: number;
  eventId: string;
  ownerWallet?: string | null;
}): { qrToken: string } {
  return {
    qrToken: signTicketQr({
      secret: QR_SIGNING_SECRET,
      contractAddress: input.contractAddress,
      ticketRootId: input.ticketRootId,
      version: input.version,
      eventId: input.eventId,
      ownerWallet: input.ownerWallet,
    }),
  };
}

function transactionHashHex(tx: { hash: () => Buffer }): string {
  return tx.hash().toString('hex');
}

async function createTransactionIntent(input: {
  userId: string;
  walletAddress: string;
  operation: string;
  contractAddress: string;
  ticketRootId: number;
  expectedVersion?: number | null;
  expectedPrice?: bigint | number | null;
  xdrHash: string;
}) {
  return prisma.transaction_intents.create({
    data: {
      user_id: input.userId,
      wallet_address: input.walletAddress,
      operation: input.operation,
      contract_address: input.contractAddress,
      ticket_root_id: input.ticketRootId,
      expected_version: input.expectedVersion ?? null,
      expected_price: input.expectedPrice != null ? BigInt(input.expectedPrice) : null,
      xdr_hash: input.xdrHash,
      expires_at: buildTransactionIntentExpiry(),
    },
    select: { id: true, expires_at: true },
  });
}

function normalizeResalePolicy(policy: any): ResalePolicyInput {
  const fallback = defaultResalePolicy();
  if (!policy) return fallback;
  return {
    enabled: Boolean(policy.enabled),
    limitType: policy.limit_type === 'FIXED_PRICE' ? 'FIXED_PRICE' : 'PERCENTAGE',
    maxPriceAmount: policy.max_price_amount != null ? Number(policy.max_price_amount) : null,
    maxPricePercent: policy.max_price_percent != null ? Number(policy.max_price_percent) : null,
    resaleStartsAt: policy.resale_starts_at ?? null,
    resaleEndsAt: policy.resale_ends_at ?? null,
    blockHoursBeforeEvent: Number(policy.block_hours_before_event ?? fallback.blockHoursBeforeEvent),
    platformFeePercent: Number(policy.platform_fee_percent ?? fallback.platformFeePercent),
    organizerFeePercent: Number(policy.organizer_fee_percent ?? fallback.organizerFeePercent),
  };
}

function formatAdminResalePolicy(eventId: string, policy: any) {
  const normalized = normalizeResalePolicy(policy);
  return {
    eventId,
    enabled: normalized.enabled,
    limitType: normalized.limitType,
    maxPriceAmount: normalized.maxPriceAmount,
    maxPricePercent: normalized.maxPricePercent,
    resaleStartsAt: normalized.resaleStartsAt ? normalized.resaleStartsAt.toISOString() : null,
    resaleEndsAt: normalized.resaleEndsAt ? normalized.resaleEndsAt.toISOString() : null,
    blockHoursBeforeEvent: normalized.blockHoursBeforeEvent,
    platformFeePercent: normalized.platformFeePercent,
    organizerFeePercent: normalized.organizerFeePercent,
  };
}

function parseOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida');
  return date;
}

function parsePolicyNumber(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} inválido`);
  return parsed;
}

function buildAdminResalePolicyInput(body: any) {
  const limitType = body?.limitType === 'FIXED_PRICE' ? 'FIXED_PRICE' : body?.limitType === 'PERCENTAGE' ? 'PERCENTAGE' : null;
  if (!limitType) throw new Error('Tipo de límite inválido');
  const enabled = Boolean(body?.enabled);

  const maxPriceAmount = body?.maxPriceAmount === null || body?.maxPriceAmount === '' || body?.maxPriceAmount === undefined
    ? null
    : parsePolicyNumber(body.maxPriceAmount, 'Precio máximo fijo');
  const maxPricePercent = body?.maxPricePercent === null || body?.maxPricePercent === '' || body?.maxPricePercent === undefined
    ? null
    : parsePolicyNumber(body.maxPricePercent, 'Porcentaje máximo');
  const blockHoursBeforeEvent = parsePolicyNumber(body?.blockHoursBeforeEvent, 'Bloqueo antes del evento');
  const platformFeePercent = parsePolicyNumber(body?.platformFeePercent, 'Comisión plataforma');
  const organizerFeePercent = parsePolicyNumber(body?.organizerFeePercent, 'Comisión organizador');
  const resaleStartsAt = parseOptionalDate(body?.resaleStartsAt);
  const resaleEndsAt = parseOptionalDate(body?.resaleEndsAt);

  if (enabled && limitType === 'FIXED_PRICE' && (!maxPriceAmount || maxPriceAmount <= 0)) {
    throw new Error('El precio máximo fijo debe ser mayor a cero');
  }
  if (enabled && limitType === 'PERCENTAGE' && (!maxPricePercent || maxPricePercent <= 0)) {
    throw new Error('El porcentaje máximo debe ser mayor a cero');
  }
  if (blockHoursBeforeEvent < 0 || blockHoursBeforeEvent > 720) {
    throw new Error('El bloqueo antes del evento debe estar entre 0 y 720 horas');
  }
  if (platformFeePercent < 0 || organizerFeePercent < 0 || platformFeePercent + organizerFeePercent > 100) {
    throw new Error('Las comisiones deben ser positivas y no superar el 100% acumulado');
  }
  if (resaleStartsAt && resaleEndsAt && resaleStartsAt >= resaleEndsAt) {
    throw new Error('La fecha de inicio debe ser anterior a la fecha de fin');
  }

  return {
    enabled,
    limit_type: limitType,
    max_price_amount: limitType === 'FIXED_PRICE' ? maxPriceAmount : null,
    max_price_percent: limitType === 'PERCENTAGE' ? maxPricePercent : null,
    resale_starts_at: resaleStartsAt,
    resale_ends_at: resaleEndsAt,
    block_hours_before_event: blockHoursBeforeEvent,
    platform_fee_percent: platformFeePercent,
    organizer_fee_percent: organizerFeePercent,
    updated_at: new Date(),
  };
}

async function getTicketResaleContext(ticketId: string, userId?: string) {
  const ticket = await prisma.tickets.findFirst({
    where: { id: ticketId, ...(userId ? { owner_user_id: userId } : {}) },
    include: {
      order_items: {
        include: {
          event_ticket_types: {
            include: {
              events: {
                include: {
                  event_resale_policies: true,
                },
              },
            },
          },
          event_seat_inventory: {
            include: {
              event_ticket_types: {
                include: {
                  events: {
                    include: {
                      event_resale_policies: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!ticket) return null;

  let ticketType = ticket.order_items?.event_ticket_types ?? ticket.order_items?.event_seat_inventory?.event_ticket_types ?? null;
  let event = ticketType?.events ?? null;
  if (!event && ticket.contract_address) {
    event = await prisma.events.findFirst({
      where: { contract_address: ticket.contract_address },
      include: { event_resale_policies: true },
    });
  }
  if (!ticketType && event?.id) {
    ticketType = await prisma.event_ticket_types.findFirst({
      where: {
        event_id: event.id,
        is_active: true,
        deleted_at: null,
      },
      include: {
        events: {
          include: {
            event_resale_policies: true,
          },
        },
      },
      orderBy: { price_amount: 'asc' },
    });
  }

  const originalPriceAmount = ticketType?.price_amount != null ? Number(ticketType.price_amount) : null;
  const policy = normalizeResalePolicy((event as any)?.event_resale_policies ?? null);
  return { ticket, event, ticketType, originalPriceAmount, policy };
}

function buildTicketResalePolicyResponse(context: NonNullable<Awaited<ReturnType<typeof getTicketResaleContext>>>, requestedPriceAmount?: number | null) {
  if (!context.event || context.originalPriceAmount == null) {
    return {
      canList: false,
      reason: 'No fue posible determinar el evento o precio original del ticket',
      ticketStatus: context.ticket.status,
      isForSale: context.ticket.is_for_sale,
      policy: null,
    };
  }
  const evaluation = evaluateResalePolicy({
    policy: context.policy,
    originalPriceAmount: context.originalPriceAmount,
    requestedPriceAmount,
    eventStartsAt: context.event.starts_at,
  });
  let canList = evaluation.ok;
  let reason = evaluation.ok ? null : evaluation.error;
  if (context.ticket.status !== 'ACTIVE') {
    canList = false;
    reason = `El ticket no está activo: ${context.ticket.status}`;
  } else if (context.ticket.is_for_sale) {
    canList = false;
    reason = 'Ticket ya está en venta';
  }
  return {
    canList,
    reason,
    ticketStatus: context.ticket.status,
    isForSale: context.ticket.is_for_sale,
    event: {
      id: context.event.id,
      title: context.event.title,
      startsAt: context.event.starts_at.toISOString(),
    },
    ticketType: context.ticketType ? {
      id: context.ticketType.id,
      name: context.ticketType.ticket_type_name,
      price: Number(context.ticketType.price_amount),
      serviceFee: Number(context.ticketType.service_fee_amount),
    } : null,
    policy: evaluation.snapshot,
  };
}

const claimIncludes = {
  users: { select: { id: true, first_name: true, last_name: true, email: true, role: true } },
  assignee: { select: { id: true, first_name: true, last_name: true, email: true, role: true } },
  messages: {
    orderBy: { created_at: 'asc' as const },
    include: { users: { select: { id: true, first_name: true, last_name: true, email: true, role: true } } },
  },
};

function formatClaim(claim: any) {
  return {
    id: claim.id,
    type: claim.type,
    status: claim.status,
    subject: claim.subject,
    description: claim.description,
    relatedTxHash: claim.related_tx_hash,
    decisionReason: claim.decision_reason,
    resolvedAt: claim.resolved_at?.toISOString?.() ?? null,
    createdAt: claim.created_at.toISOString(),
    updatedAt: claim.updated_at.toISOString(),
    ticketId: claim.ticket_id,
    orderId: claim.order_id,
    eventId: claim.event_id,
    evidence: claim.evidence,
    user: claim.users ? {
      id: claim.users.id,
      name: `${claim.users.first_name} ${claim.users.last_name}`.trim(),
      email: claim.users.email,
      role: claim.users.role,
    } : null,
    assignedTo: claim.assignee ? {
      id: claim.assignee.id,
      name: `${claim.assignee.first_name} ${claim.assignee.last_name}`.trim(),
      email: claim.assignee.email,
      role: claim.assignee.role,
    } : null,
    messages: (claim.messages ?? []).map((m: any) => ({
      id: m.id,
      message: m.message,
      statusFrom: m.status_from,
      statusTo: m.status_to,
      createdAt: m.created_at.toISOString(),
      author: m.users ? {
        id: m.users.id,
        name: `${m.users.first_name} ${m.users.last_name}`.trim(),
        email: m.users.email,
        role: m.users.role,
      } : null,
    })),
  };
}

async function buildPqrEvidence(input: {
  userId: string;
  ticketId?: string | null;
  orderId?: string | null;
  eventId?: string | null;
  relatedTxHash?: string | null;
}) {
  const now = new Date();
  const ticket = input.ticketId ? await prisma.tickets.findUnique({
    where: { id: input.ticketId },
    include: {
      order_items: {
        include: {
          orders: true,
          event_ticket_types: { include: { events: true } },
          event_seat_inventory: {
            include: {
              seats: { include: { venue_sections: true } },
              event_ticket_types: { include: { events: true } },
            },
          },
        },
      },
      checkins: { orderBy: { created_at: 'desc' }, take: 3 },
    },
  }) : null;

  if (input.ticketId && !ticket) return { ok: false as const, status: 404, error: 'Ticket no encontrado' };
  if (ticket && ticket.owner_user_id !== input.userId) return { ok: false as const, status: 403, error: 'No puedes reclamar un ticket de otro usuario' };

  const explicitOrder = input.orderId ? await prisma.orders.findFirst({
    where: { id: input.orderId, user_id: input.userId },
    include: { order_items: true },
  }) : null;
  if (input.orderId && !explicitOrder) return { ok: false as const, status: 404, error: 'Orden no encontrada' };

  const order = explicitOrder ?? ticket?.order_items?.orders ?? null;
  const ticketType = ticket?.order_items?.event_ticket_types ?? ticket?.order_items?.event_seat_inventory?.event_ticket_types ?? null;
  let event = ticketType?.events ?? null;
  if (!event && input.eventId) {
    event = await prisma.events.findUnique({ where: { id: input.eventId } });
  }
  if (!event && ticket?.contract_address) {
    event = await prisma.events.findFirst({ where: { contract_address: ticket.contract_address } });
  }
  if (input.eventId && !event) return { ok: false as const, status: 404, error: 'Evento no encontrado' };

  const latestOnchainEvent = ticket?.contract_address && ticket.ticket_root_id != null
    ? await prisma.onchain_events.findFirst({
        where: {
          contract_address: ticket.contract_address,
          ticket_root_id: ticket.ticket_root_id,
        },
        orderBy: { processed_at: 'desc' },
      })
    : null;

  return {
    ok: true as const,
    ticketId: ticket?.id ?? null,
    orderId: order?.id ?? null,
    eventId: event?.id ?? input.eventId ?? null,
    evidence: {
      capturedAt: now.toISOString(),
      ticket: ticket ? {
        id: ticket.id,
        status: ticket.status,
        lifecycleReason: ticket.lifecycle_reason,
        ownerUserId: ticket.owner_user_id,
        ownerWallet: ticket.owner_wallet,
        contractAddress: ticket.contract_address,
        ticketRootId: ticket.ticket_root_id,
        version: ticket.version,
        isForSale: ticket.is_for_sale,
        resalePrice: ticket.resale_price?.toString?.() ?? null,
        nftTokenId: ticket.nft_token_id,
        usedAt: ticket.used_at?.toISOString?.() ?? null,
        updatedAt: ticket.updated_at.toISOString(),
      } : null,
      order: order ? {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        totalAmount: Number(order.total_amount),
        createdAt: order.created_at.toISOString(),
      } : null,
      event: event ? {
        id: event.id,
        title: event.title,
        contractAddress: event.contract_address,
        nftContractAddress: event.nft_contract_address,
        startsAt: event.starts_at.toISOString(),
      } : null,
      latestOnchainEvent: latestOnchainEvent ? {
        txHash: latestOnchainEvent.tx_hash,
        eventName: latestOnchainEvent.event_name,
        ticketRootId: latestOnchainEvent.ticket_root_id,
        version: latestOnchainEvent.version,
        status: latestOnchainEvent.status,
        processedAt: latestOnchainEvent.processed_at.toISOString(),
      } : null,
      latestCheckins: (ticket?.checkins ?? []).map((c) => ({
        id: c.id,
        result: c.result,
        source: c.source,
        reason: c.reason,
        createdAt: c.created_at.toISOString(),
      })),
      relatedTxHash: input.relatedTxHash ?? null,
    },
  };
}

async function mintTicketNftWithBump(input: {
  nftContractAddress: string;
  contractAddress: string;
  ticketRootId: number;
  buyerWallet: string;
}): Promise<{ nftTokenId: number; nftMintTxHash: string | null }> {
  if (!organizerKeypair) {
    throw new Error('Blockchain no configurada');
  }

  const attemptMint = async (tokenId: number) => {
    const tokenUri = `${PUBLIC_BASE_URL}/api/nft/metadata/${input.nftContractAddress}/${tokenId}`;
    const result = await invokeSoroban(
      organizerKeypair,
      input.nftContractAddress,
      'mint',
      [
        new Address(input.buyerWallet).toScVal(),
        nativeToScVal(tokenId, { type: 'u32' }),
        nativeToScVal(tokenUri, { type: 'string' }),
      ],
    );
    return (result as any).txHash ?? null;
  };

  try {
    return {
      nftTokenId: input.ticketRootId,
      nftMintTxHash: await attemptMint(input.ticketRootId),
    };
  } catch (mintErr: any) {
    const msg = String(mintErr?.message ?? '');
    if (!msg.includes('TokenYaExiste') && !msg.includes('#3')) {
      throw mintErr;
    }

    const maxAgg = await prisma.tickets.aggregate({
      where: { contract_address: input.contractAddress } as any,
      _max: { nft_token_id: true } as any,
    });
    const maxId = ((maxAgg as any)._max?.nft_token_id as number | null) ?? 0;
    const bumped = Math.max(maxId, input.ticketRootId) + 1;

    return {
      nftTokenId: bumped,
      nftMintTxHash: await attemptMint(bumped),
    };
  }
}

async function burnAndMintResaleNft(input: {
  nftContractAddress: string;
  contractAddress: string;
  ticketRootId: number;
  buyerWallet: string;
}): Promise<{
  burnTxHash: string | null;
  mintTxHash: string | null;
  nftTokenId: number;
  alreadyTransferred?: boolean;
}> {
  if (!organizerKeypair) {
    throw new Error('Blockchain no configurada');
  }

  const oldRow = await prisma.tickets.findFirst({
    where: {
      contract_address: input.contractAddress,
      ticket_root_id: input.ticketRootId,
      status: 'CANCELLED',
    } as any,
    orderBy: { version: 'desc' },
    select: { nft_token_id: true } as any,
  });
  const oldNftTokenId = ((oldRow as any)?.nft_token_id as number | null) ?? input.ticketRootId;

  const burnOldToken = async () => {
    const adminScVal = new Address(organizerKeypair.publicKey()).toScVal();
    try {
      const burnResult = await invokeSoroban(
        organizerKeypair,
        input.nftContractAddress,
        'burn',
        [adminScVal, nativeToScVal(oldNftTokenId, { type: 'u32' })],
      );
      console.log(`[NFT] burned token=${oldNftTokenId} on ${input.nftContractAddress.slice(0, 8)}...`);
      return (burnResult as any).txHash ?? null;
    } catch (error: any) {
      const msg = String(error?.message ?? '');
      if (msg.includes('TokenNoEncontrado') || msg.includes('#4')) {
        console.log(`[NFT] burn skipped (token=${oldNftTokenId} already gone)`);
        return null;
      }
      throw error;
    }
  };

  const newRow = await prisma.tickets.findFirst({
    where: {
      contract_address: input.contractAddress,
      ticket_root_id: input.ticketRootId,
      status: 'ACTIVE',
      owner_wallet: input.buyerWallet,
    } as any,
    orderBy: { version: 'desc' },
    select: { id: true, nft_token_id: true } as any,
  });
  if (!newRow) {
    const err = new Error('El indexer aun no procesa la reventa. Espera unos segundos e intenta de nuevo.');
    (err as any).status = 409;
    throw err;
  }

  const existingNewTokenId = (newRow as any).nft_token_id as number | null;
  if (existingNewTokenId != null && existingNewTokenId !== oldNftTokenId) {
    return {
      burnTxHash: await burnOldToken(),
      mintTxHash: null,
      nftTokenId: existingNewTokenId,
      alreadyTransferred: true,
    };
  }

  const allocateTokenId = async () => {
    const maxAgg = await prisma.tickets.aggregate({
      where: { contract_address: input.contractAddress } as any,
      _max: { nft_token_id: true } as any,
    });
    const maxId = ((maxAgg as any)._max?.nft_token_id as number | null) ?? 0;
    return Math.max(maxId, input.ticketRootId) + 1;
  };

  const burnTxHash = await burnOldToken();

  const attemptMint = async (tokenId: number) => {
    const tokenUri = `${PUBLIC_BASE_URL}/api/nft/metadata/${input.nftContractAddress}/${tokenId}`;
    const mintResult = await invokeSoroban(
      organizerKeypair,
      input.nftContractAddress,
      'mint',
      [
        new Address(input.buyerWallet).toScVal(),
        nativeToScVal(tokenId, { type: 'u32' }),
        nativeToScVal(tokenUri, { type: 'string' }),
      ],
    );
    return (mintResult as any).txHash ?? null;
  };

  let nftTokenId = await allocateTokenId();
  let mintTxHash: string | null = null;
  try {
    mintTxHash = await attemptMint(nftTokenId);
  } catch (error: any) {
    const msg = String(error?.message ?? '');
    if (!msg.includes('TokenYaExiste') && !msg.includes('#3')) {
      throw error;
    }
    nftTokenId = await allocateTokenId();
    mintTxHash = await attemptMint(nftTokenId);
  }

  await prisma.tickets.update({
    where: { id: (newRow as any).id },
    data: { nft_token_id: nftTokenId } as any,
  });

  return { burnTxHash, mintTxHash, nftTokenId };
}

// GET /api/tickets/qr/:assetCode.png — public PNG referenced by stellar.toml.
// QR encodes a signed token bound to contract, root, version, event and owner,
// so stale or transferred ticket images are rejected by the scanner.
app.get('/api/tickets/qr/:assetCode.png', async (req, res) => {
  try {
    const assetCode = req.params.assetCode.replace(/\.png$/i, '');
    if (!/^T[0-9A-F]{1,11}$/.test(assetCode)) {
      res.status(400).type('text/plain').send('Invalid asset code');
      return;
    }

    const ticket = await prisma.tickets.findFirst({
      where: { asset_code: assetCode, contract_address: { not: null } },
      select: {
        contract_address: true,
        ticket_root_id: true,
        owner_wallet: true,
        order_items: {
          select: {
            event_ticket_types: {
              select: { event_id: true },
            },
          },
        },
      } as any,
    });
    if (!ticket?.contract_address || (ticket as any).ticket_root_id == null) {
      res.status(404).type('text/plain').send('Ticket not found');
      return;
    }
    let eventId = (ticket as any).order_items?.event_ticket_types?.event_id as string | undefined;
    if (!eventId) {
      const event = await prisma.events.findFirst({
        where: { contract_address: ticket.contract_address } as any,
        select: { id: true } as any,
      });
      eventId = (event as any)?.id;
    }
    if (!eventId) {
      res.status(404).type('text/plain').send('Event not found');
      return;
    }
    const live = await prisma.tickets.findFirst({
      where: {
        contract_address: String(ticket.contract_address),
        ticket_root_id: (ticket as any).ticket_root_id,
        status: 'ACTIVE',
      },
      orderBy: { version: 'desc' },
      select: { version: true, owner_wallet: true } as any,
    });
    const version = (live as any)?.version ?? 1;
    const ownerWallet = (live as any)?.owner_wallet ?? (ticket as any).owner_wallet ?? null;
    const cacheKey = `${assetCode}:v${version}:w${ownerWallet ?? '-'}`;

    if (!qrCache.has(cacheKey)) {
      const buf = await buildTicketQrPng(buildSignedTicketQrPayload({
        contractAddress: String(ticket.contract_address),
        ticketRootId: (ticket as any).ticket_root_id,
        version,
        eventId,
        ownerWallet,
      }));
      qrCache.set(cacheKey, buf);
    }

    const png = qrCache.get(cacheKey)!;
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err: any) {
    console.error('[qr] error:', err?.message);
    res.status(500).type('text/plain').send('Error generating QR');
  }
});

app.get('/.well-known/stellar.toml', async (_req, res) => {
  try {
    const issuer = organizerKeypair?.publicKey();
    if (!issuer) {
      res.status(503).type('text/plain').send('# Issuer not configured');
      return;
    }
    // Pull tickets + map contract_address -> event so each collectible carries
    // the event name. tickets has no direct relation to events; we join via the
    // unique events.contract_address.
    const tickets = await prisma.tickets.findMany({
      where: { asset_code: { not: null }, contract_address: { not: null } },
      select: { asset_code: true, contract_address: true },
      distinct: ['asset_code'],
    });
    const contractAddrs = Array.from(
      new Set(tickets.map(t => t.contract_address!).filter(Boolean))
    );
    const events = contractAddrs.length
      ? await prisma.events.findMany({
          where: { contract_address: { in: contractAddrs } },
          select: { contract_address: true, title: true, starts_at: true },
        })
      : [];
    const eventByContract = new Map(
      events.map(e => [e.contract_address!, { title: e.title, starts_at: e.starts_at }])
    );

    const lines: string[] = [
      'VERSION="2.0.0"',
      `NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE}"`,
      '',
      '[DOCUMENTATION]',
      'ORG_NAME="Stellar Tickets"',
      'ORG_DESCRIPTION="Plataforma Web2.5 de boletería con NFTs en Stellar (tesis)"',
      `ORG_URL="${PUBLIC_BASE_URL}"`,
      '',
      '[[PRINCIPALS]]',
      'name="Stellar Tickets Issuer"',
      `github="ElAreaAl2"`,
      '',
    ];

    for (const t of tickets) {
      const ev = eventByContract.get(t.contract_address!);
      const eventTitle = (ev?.title ?? 'Boleto').replace(/"/g, '\\"').slice(0, 60);
      const startsAt = ev?.starts_at
        ? new Date(ev.starts_at).toISOString().slice(0, 10)
        : '';
      const desc =
        `Boleto NFT — ${eventTitle}${startsAt ? ` (${startsAt})` : ''}. ` +
        `Escanea el QR en puerta para validar.`;
      lines.push('[[CURRENCIES]]');
      lines.push(`code="${t.asset_code}"`);
      lines.push(`issuer="${issuer}"`);
      lines.push('is_asset_anchored=false');
      lines.push('display_decimals=0');
      lines.push('fixed_number=1');
      lines.push('max_number=1');
      lines.push(`name="${eventTitle}"`);
      lines.push(`desc="${desc.replace(/"/g, '\\"')}"`);
      lines.push(`image="${PUBLIC_BASE_URL}/api/tickets/qr/${t.asset_code}.png"`);
      lines.push('');
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.type('text/plain').send(lines.join('\n'));
  } catch (err: any) {
    console.error('[stellar.toml] error:', err?.message);
    res.status(500).type('text/plain').send('# Error generating stellar.toml');
  }
});

// Root: API only (SPA runs on Vite, typically http://localhost:8080)
app.get('/', (_req, res) => {
  res.type('text').send(
    'Stellar Tickets API. Usa GET /health o rutas /api/... . El frontend (Vite) suele estar en http://localhost:8080'
  );
});

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'stellar-tickets-backend' });
});

// --- WEB2 CATALOG ENDPOINTS ---

// Event images mapped by slug (Unsplash stable IDs, free to use)
const EVENT_IMAGES: Record<string, { poster: string; banner: string }> = {
  'obra-clasica-medellin-2026':    { poster: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=1200&h=400&fit=crop' },
  'noche-standup-medellin-2026':   { poster: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=1200&h=400&fit=crop' },
  'concierto-estrella-2026':       { poster: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&h=400&fit=crop' },
  'teatro-noir-medellin-2026':     { poster: 'https://images.unsplash.com/photo-1507924538820-ede94a04019d?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1507924538820-ede94a04019d?w=1200&h=400&fit=crop' },
  'clasico-capital-2026':          { poster: 'https://images.unsplash.com/photo-1459865264687-595d652de67e?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1459865264687-595d652de67e?w=1200&h=400&fit=crop' },
  'comedy-central-medellin-2026':  { poster: 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=1200&h=400&fit=crop' },
  'festival-familiar-bogota-2026': { poster: 'https://images.unsplash.com/photo-1472653431158-6364773b2a56?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1472653431158-6364773b2a56?w=1200&h=400&fit=crop' },
  'festival-urbano-2026':          { poster: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&h=400&fit=crop' },
  'indie-live-bogota-2026':        { poster: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&h=400&fit=crop' },
  'caribe-fest-barranquilla-2026': { poster: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=1200&h=400&fit=crop' },
  'final-copa-capital-2026':       { poster: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&h=500&fit=crop', banner: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=1200&h=400&fit=crop' },
};

// Fallback images by category
const CATEGORY_IMAGES: Record<string, string> = {
  CONCERTS: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&h=500&fit=crop',
  THEATER: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&h=500&fit=crop',
  SPORTS: 'https://images.unsplash.com/photo-1459865264687-595d652de67e?w=800&h=500&fit=crop',
  COMEDY: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=800&h=500&fit=crop',
  FESTIVALS: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&h=500&fit=crop',
  FAMILY: 'https://images.unsplash.com/photo-1472653431158-6364773b2a56?w=800&h=500&fit=crop',
};

// Transform a Prisma event row into the DTO the frontend expects
function toEventDto(event: any) {
  const prices = (event.event_ticket_types ?? []).map((t: any) => Number(t.price_amount));
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const slug = event.slug ?? '';
  const category = event.event_categories?.code ?? '';
  const images = EVENT_IMAGES[slug];
  const fallback = CATEGORY_IMAGES[category] || 'https://placehold.co/800x500?text=Evento';
  const uploaded = event.cover_image_url ?? null;
  return {
    id: event.id,
    slug,
    title: event.title,
    description: event.description ?? '',
    category,
    categoryLabel: event.event_categories?.display_name ?? '',
    city: event.venues?.cities?.city_name ?? null,
    organizer: event.organizers?.legal_name ?? '',
    venue: { name: event.venues?.name ?? '' },
    venueType: event.venues?.venue_type ?? null,
    startsAt: event.starts_at,
    hasAssignedSeating: event.has_assigned_seating,
    minPrice: minPrice,
    isFeatured: false,
    contract_address: event.contract_address,
    posterImage: uploaded ?? images?.poster ?? fallback,
    bannerImage: uploaded ?? images?.banner ?? fallback,
  };
}

const eventIncludes = {
  venues: { include: { cities: true } },
  organizers: true,
  event_categories: true,
  event_ticket_types: { where: { is_active: true } },
};

async function getTicketTypeAvailability(eventId: string, ticketType: any, hasAssignedSeating: boolean): Promise<number> {
  if (hasAssignedSeating || ticketType.venue_section_id) {
    return prisma.event_seat_inventory.count({
      where: {
        event_id: eventId,
        event_ticket_type_id: ticketType.id,
        status: 'AVAILABLE',
      },
    });
  }

  const inventory = Number(ticketType.inventory_quantity ?? 0);
  if (inventory <= 0) return 0;

  const sold = await prisma.order_items.aggregate({
    where: {
      event_ticket_type_id: ticketType.id,
      orders: { status: 'PAID' },
    },
    _sum: { quantity: true },
  });

  return Math.max(0, inventory - Number(sold._sum.quantity ?? 0));
}

const EVENT_LIST_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeEventSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function eventMatchesSearch(event: ReturnType<typeof toEventDto>, search: string): boolean {
  const needle = normalizeEventSearchText(search);
  if (!needle) return true;
  if (EVENT_LIST_UUID_RE.test(search) && event.id === search) return true;

  const haystack = normalizeEventSearchText([
    event.title,
    event.description,
    event.categoryLabel,
    event.city,
    event.organizer,
    event.venue?.name,
  ].join(' '));
  return haystack.includes(needle);
}

function buildPublishedEventsWhere(category: string, city: string): Prisma.eventsWhereInput {
  const where: Prisma.eventsWhereInput = { status: 'PUBLISHED' };
  if (category) {
    where.event_categories = { display_name: { equals: category, mode: 'insensitive' } };
  }
  if (city) {
    where.venues = { cities: { city_name: { equals: city, mode: 'insensitive' } } };
  }
  return where;
}

// GET /api/events - List published events (optional query: search, category, city, sort)
app.get('/api/events', async (req, res) => {
  try {
    const search = String(req.query.search ?? '').trim();
    const category = String(req.query.category ?? '').trim();
    const city = String(req.query.city ?? '').trim();
    const sort = String(req.query.sort ?? '').trim();
    const hasFilters = Boolean(search || category || city || sort);

    if (!hasFilters) {
      const events = await cached('events:all', 60_000, () =>
        prisma.events.findMany({ where: { status: 'PUBLISHED' }, include: eventIncludes, orderBy: { starts_at: 'asc' } })
      );
      res.json(events.map(toEventDto));
      return;
    }

    const cacheKey = `events:filter:${encodeURIComponent(search)}:${encodeURIComponent(category)}:${encodeURIComponent(city)}:${encodeURIComponent(sort)}`;
    const rows = await cached(cacheKey, 30_000, () =>
      prisma.events.findMany({
        where: buildPublishedEventsWhere(category, city),
        include: eventIncludes,
        orderBy: { starts_at: 'asc' },
      })
    );

    let dtoList = rows.map(toEventDto).filter((event) => eventMatchesSearch(event, search));
    if (sort === 'price_asc' || sort === 'price_desc') {
      const dir = sort === 'price_asc' ? 1 : -1;
      dtoList = [...dtoList].sort((a, b) => {
        const pa = Number((a as { minPrice?: number }).minPrice ?? 0);
        const pb = Number((b as { minPrice?: number }).minPrice ?? 0);
        if (pa !== pb) return (pa - pb) * dir;
        return String(a.title ?? '').localeCompare(String(b.title ?? ''), 'es');
      });
    }

    res.json(dtoList);
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo eventos');
  }
});

// GET /api/events/featured - Featured events
app.get('/api/events/featured', async (req, res) => {
  try {
    const events = await cached('events:featured', 60_000, () =>
      prisma.events.findMany({ where: { status: 'PUBLISHED' }, include: eventIncludes, orderBy: { starts_at: 'asc' }, take: 6 })
    );
    res.json(events.map(toEventDto));
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo eventos destacados');
  }
});

// GET /api/events/:slug - Event details
app.get('/api/events/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    const event = await cached(`events:slug:${slug}`, 30_000, () =>
      prisma.events.findFirst({
        where: isUuid ? { OR: [{ id: slug }, { slug }] } : { slug },
        include: eventIncludes,
      })
    );

    if (!event) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Evento no encontrado');
      return;
    }

    // Live tickets are NOT cached (change frequently with resale)
    let live_tickets: any[] = [];
    if (event.contract_address) {
       const rawTickets = await cached(`events:live-tickets:${event.contract_address}`, 30_000, () =>
         prisma.tickets.findMany({
           where: { contract_address: event.contract_address, is_for_sale: true, status: 'ACTIVE' },
           select: {
             id: true, ticket_root_id: true, version: true, owner_wallet: true, contract_address: true, resale_price: true, asset_code: true,
             nft_token_id: true,
           } as any,
         })
       ) as any[];
       live_tickets = rawTickets.map(t => ({
         id: t.id,
         ticketRootId: t.ticket_root_id,
         version: t.version,
         sellerWallet: t.owner_wallet,
         contractAddress: t.contract_address,
         resalePrice: t.resale_price ? Number(t.resale_price) : null,
         assetCode: t.asset_code,
         nftTokenId: t.nft_token_id ?? null,
       }));
    }

    // Include ticket types in detail response to avoid extra API call
    const ticketTypes = await Promise.all((event.event_ticket_types ?? []).map(async (t: any) => ({
      id: t.id,
      name: t.ticket_type_name,
      price: Number(t.price_amount),
      serviceFee: Number(t.service_fee_amount),
      availability: await getTicketTypeAvailability(event.id, t, Boolean(event.has_assigned_seating)),
      maxPerOrder: t.max_per_order ?? 10,
    })));

    res.json({
      ...toEventDto(event),
      live_tickets,
      contractAddress: event.contract_address,
      nftContractAddress: (event as any).nft_contract_address ?? null,
      ticketTypes,
    });
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo evento');
  }
});

// GET /api/events/:id/ticket-types - Ticket types for an event
app.get('/api/events/:id/ticket-types', async (req, res) => {
  try {
    const event = await prisma.events.findUnique({
      where: { id: req.params.id },
      include: { event_ticket_types: { where: { is_active: true } } },
    });
    if (!event) { sendApiError(req, res, 404, 'NOT_FOUND', 'Evento no encontrado'); return; }

    const types = await Promise.all(event.event_ticket_types.map(async (t: any) => ({
      id: t.id,
      name: t.ticket_type_name,
      price: Number(t.price_amount),
      serviceFee: Number(t.service_fee_amount),
      availability: await getTicketTypeAvailability(event.id, t, Boolean(event.has_assigned_seating)),
      maxPerOrder: t.max_per_order ?? 10,
    })));

    res.json(types);
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo tipos de boleto');
  }
});

// GET /api/events/:id/seats - Sections + seats + availability for seat-map rendering
app.get('/api/events/:id/seats', async (req, res) => {
  try {
    const eventId = req.params.id;
    await releaseExpiredSeatHolds();

    const event = await prisma.events.findUnique({
      where: { id: eventId },
      include: {
        venues: true,
        event_ticket_types: {
          where: { is_active: true, venue_section_id: { not: null } },
          select: {
            id: true,
            venue_section_id: true,
            ticket_type_name: true,
            price_amount: true,
            service_fee_amount: true,
            max_per_order: true,
          },
        },
      },
    });

    if (!event) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Evento no encontrado');
      return;
    }

    if (!event.has_assigned_seating) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Este evento no tiene selección de asientos');
      return;
    }

    // Build a map: venue_section_id -> ticket_type
    const ttBySectionId = new Map<string, any>();
    for (const tt of event.event_ticket_types) {
      if (tt.venue_section_id) ttBySectionId.set(tt.venue_section_id, tt);
    }

    // Get all venue sections for this venue (that have a ticket type for this event)
    const sectionIds = [...ttBySectionId.keys()];
    const sections = await prisma.venue_sections.findMany({
      where: { id: { in: sectionIds } },
      include: {
        seats: {
          where: { is_active: true },
          orderBy: [{ row_label: 'asc' }, { seat_number: 'asc' }],
        },
      },
      orderBy: { section_name: 'asc' },
    });

    // Get all inventory records for this event in these sections
    const seatIds = sections.flatMap(s => s.seats.map(seat => seat.id));
    const inventory = await prisma.event_seat_inventory.findMany({
      where: { event_id: eventId, seat_id: { in: seatIds } },
      select: { id: true, seat_id: true, status: true },
    });
    const inventoryBySeatId = new Map(inventory.map(inv => [inv.seat_id, inv]));

    const sectionsDto = sections.map(section => {
      const tt = ttBySectionId.get(section.id);
      return {
        id: section.id,
        name: section.section_name,
        code: section.section_code,
        hasNumberedSeats: section.has_numbered_seats,
        capacity: section.capacity,
        ticketTypeId: tt?.id ?? null,
        price: tt ? Number(tt.price_amount) : 0,
        serviceFee: tt ? Number(tt.service_fee_amount) : 0,
        maxPerOrder: tt?.max_per_order ?? 6,
        seats: section.seats.map(seat => {
          const inv = inventoryBySeatId.get(seat.id);
          return {
            inventoryId: inv?.id ?? null,
            seatId: seat.id,
            label: seat.seat_label,
            row: seat.row_label ?? '',
            number: seat.seat_number ?? 0,
            isAccessible: seat.is_accessible,
            status: inv?.status ?? 'AVAILABLE',
          };
        }),
      };
    });

    res.json({
      venueType: event.venues.venue_type,
      venueName: event.venues.name,
      sections: sectionsDto,
    });
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo asientos');
  }
});

// GET /api/events/:id/related - Related events (same category)
app.get('/api/events/:id/related', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await cached(`events:related:${id}`, 60_000, async () => {
      const event = await prisma.events.findUnique({ where: { id }, select: { category_id: true } });
      if (!event) return [];
      const related = await prisma.events.findMany({
        where: { category_id: event.category_id, status: 'PUBLISHED', id: { not: id } },
        include: eventIncludes,
        take: 4,
      });
      return related.map(toEventDto);
    });
    res.json(result);
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo eventos relacionados');
  }
});

// (Removed) GET /api/events/:id/occupied-seats
// Replaced by GET /api/events/:id/seats which returns per-seat status from event_seat_inventory.

// POST /api/transactions/buy - Prepare Web3 Transaction Payload
app.post('/api/transactions/buy', async (req, res) => {
  try {
    const { event_slug, ticket_root_id, version, buyer_public_key } = req.body;
    
    const event = await prisma.events.findFirst({ where: { slug: event_slug } });
    if (!event || !event.contract_address) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Evento no válido o sin contrato asignado');
      return;
    }

    // In a Web2.5 Hybrid model, the backend doesn't hold the private keys.
    // It either builds the XDR or simply returns the exact contract parameters
    // so the Frontend can use @stellar/freighter-api to request the user's signature.
    
    const payload = {
      network: 'TESTNET',
      contractId: event.contract_address,
      method: 'comprar_boleto',
      args: {
        root_id: ticket_root_id,
        version: version,
        comprador: buyer_public_key
      },
      message: 'Payload listo para ser firmado por Freighter en el Frontend'
    };

    res.json(payload);
  } catch (error: any) {
    console.error(error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error preparando compra');
  }
});

// POST /api/transactions/secure-ticket — Register ticket on Soroban blockchain
// The organizer issues the ticket on-chain directly to the user's linked wallet.
app.post('/api/transactions/secure-ticket', authMiddleware, async (req, res) => {
  try {
    if (!organizerKeypair) {
      sendApiError(req, res, 503, 'BLOCKCHAIN_NOT_CONFIGURED', 'Blockchain no configurada');
      return;
    }

    const { ticketId } = req.body;
    if (!ticketId) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'ticketId es requerido');
      return;
    }

    // Find ticket and its event
    const ticket = await prisma.tickets.findUnique({
      where: { id: ticketId },
      include: {
        order_items: {
          include: {
            event_ticket_types: {
              include: { events: true },
            },
            event_seat_inventory: {
              include: {
                event_ticket_types: {
                  include: { events: true },
                },
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Ticket no encontrado');
      return;
    }
    if (ticket.owner_user_id !== (req as any).userId) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'No autorizado');
      return;
    }
    const ownerUser = await prisma.users.findUnique({
      where: { id: (req as any).userId },
      select: { wallet_address: true },
    });
    if (!ownerUser?.wallet_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Debes vincular una wallet antes de asegurar el ticket en blockchain');
      return;
    }

    const ticketType = ticket.order_items?.event_ticket_types ?? ticket.order_items?.event_seat_inventory?.event_ticket_types;
    const event = ticketType?.events;
    if (ticket.contract_address && ticket.nft_token_id == null && ticket.ticket_root_id != null && ticket.owner_wallet) {
      const eventForNft = event?.nft_contract_address
        ? event
        : await prisma.events.findFirst({
            where: { contract_address: ticket.contract_address },
            select: { id: true, nft_contract_address: true },
          });

      if (!eventForNft?.nft_contract_address) {
        sendApiError(req, res, 400, 'BAD_REQUEST', 'Evento sin nft_contract_address (NFT no desplegado)');
        return;
      }

      try {
        const minted = await mintTicketNftWithBump({
          nftContractAddress: eventForNft.nft_contract_address,
          contractAddress: ticket.contract_address,
          ticketRootId: ticket.ticket_root_id,
          buyerWallet: ticket.owner_wallet,
        });
        await prisma.tickets.update({
          where: { id: ticketId },
          data: { nft_token_id: minted.nftTokenId } as any,
        });
        res.json({
          success: true,
          txHash: minted.nftMintTxHash,
          contractAddress: ticket.contract_address,
          ticketRootId: ticket.ticket_root_id,
          chainEventId: deriveChainEventId(eventForNft.id),
          nftContractAddress: eventForNft.nft_contract_address,
          nftTokenId: minted.nftTokenId,
          nftMintTxHash: minted.nftMintTxHash,
          networkPassphrase: NETWORK_PASSPHRASE,
          network: 'TESTNET',
          completedPendingNft: true,
        });
        return;
      } catch (mintErr: any) {
        const detail = String(mintErr?.message ?? 'Error desconocido');
        console.warn('[NFT] pending mint retry failed:', detail);
        sendApiError(req, res, 502, 'SOROBAN_FAILED', `Ticket asegurado, pero no fue posible mintear el NFT pendiente: ${detail.slice(0, 180)}`);
        return;
      }
    }

    if (!event?.contract_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Evento sin contrato desplegado');
      return;
    }

    if (ticket.contract_address) {
      sendApiError(req, res, 409, 'CONFLICT', 'Ticket ya asegurado en blockchain');
      return;
    }

    const contractAddress = event.contract_address;
    const chainEventId = deriveChainEventId(event.id);
    // Use at least 1 stroop — price=0 is rejected by the contract (PrecioInvalido)
    // The price stored in DB may use different units (cents, etc.) — here we just
    // record the ticket's monetary value on-chain for commission math.
    const rawPrice = Number(ticketType?.price_amount || 0);
    const price = rawPrice > 0 ? rawPrice : 1_000_000; // fallback: 1 XLM in stroops
    console.log(`[SOROBAN] Contract: ${contractAddress.slice(0,8)}, chain_event_id=${chainEventId}, price=${price}`);

    // Build and submit crear_boleto_para transaction
    // We use crear_boleto_para with es_reventa=true because the real primary
    // sale already happened off-chain (PSE/credit card). On-chain, the ticket
    // is minted directly to the buyer's wallet and marked as revendible so
    // that any future secondary sale correctly distributes commissions.
    const buyerWallet = ownerUser?.wallet_address;
    if (!buyerWallet) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'El usuario no tiene wallet vinculada. Vincula tu wallet primero.');
      return;
    }

    console.log(`[SOROBAN] Minting ticket on-chain for contract ${contractAddress.slice(0, 8)}... buyer=${buyerWallet.slice(0, 8)}...`);

    const accountResponse = await sorobanServer.getAccount(organizerKeypair.publicKey());
    const account = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

    const tx = new TransactionBuilder(account, {
      fee: '10000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: contractAddress,
        function: 'crear_boleto_para',
        args: [
          nativeToScVal(chainEventId, { type: 'u32' }),           // id_evento derivado del evento DB
          new Address(buyerWallet).toScVal(),                     // propietario = buyer
          nativeToScVal(price, { type: 'i128' }),                 // precio
          nativeToScVal(true, { type: 'bool' }),                  // es_reventa = true
        ],
      }))
      .setTimeout(60)
      .build();

    // Simulate
    const simResponse = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResponse)) {
      console.error('[SOROBAN] Simulation failed:', (simResponse as any).error);
      sendApiError(req, res, 400, 'SOROBAN_SIMULATION_FAILED', 'No fue posible preparar la transaccion blockchain');
      return;
    }
    // Warn if contract entries need restoration (TTL expired)
    if ((simResponse as any).restorePreamble) {
      console.warn('[SOROBAN] ⚠️ restorePreamble detected — contract entries may be archived. Submit a RestoreFootprintOp first.');
    }

    // Assemble and sign with organizer key
    const assembled = SorobanRpc.assembleTransaction(tx, simResponse).build();
    assembled.sign(organizerKeypair);

    // Submit
    const sendResponse = await sorobanServer.sendTransaction(assembled);
    if (sendResponse.status === 'ERROR') {
      console.error('[SOROBAN] Send failed:', sendResponse);
      sendApiError(req, res, 400, 'SOROBAN_REJECTED', 'La red rechazo la transaccion');
      return;
    }

    // Poll for result
    let getResponse: SorobanRpc.Api.GetTransactionResponse;
    let attempts = 0;
    do {
      await new Promise((r) => setTimeout(r, 2000));
      getResponse = await sorobanServer.getTransaction(sendResponse.hash);
      attempts++;
    } while (getResponse.status === 'NOT_FOUND' && attempts < 30);

    if (getResponse.status !== 'SUCCESS') {
      const resultMeta = (getResponse as any).resultMetaXdr;
      const resultXdrParsed = (getResponse as any).resultXdr;

      // Dump base64 so we can inspect with stellar-xdr-json or laboratory if needed
      let metaB64 = 'n/a', resB64 = 'n/a';
      try { metaB64 = resultMeta?.toXDR?.('base64') ?? 'n/a'; } catch {}
      try { resB64 = resultXdrParsed?.toXDR?.('base64') ?? 'n/a'; } catch {}

      // Try extracting diagnostic events from any meta version
      let diagnosticSummary: string[] = [];
      const tryExtractFromMeta = (meta: any) => {
        const out: string[] = [];
        const versions = ['v0', 'v1', 'v2', 'v3', 'v4'];
        for (const v of versions) {
          try {
            const inner = meta?.[v]?.();
            const sorobanMeta = inner?.sorobanMeta?.();
            const diagEvents: any[] = sorobanMeta?.diagnosticEvents?.() ?? [];
            const events: any[] = sorobanMeta?.events?.() ?? [];
            const returnValue = sorobanMeta?.returnValue?.();
            for (const e of diagEvents) {
              try {
                const inSuccess = e.inSuccessfulContractCall?.();
                const evt = e.event?.();
                const v0 = evt?.body?.()?.v0?.();
                const topics = (v0?.topics?.() ?? []).map((t: any) => {
                  try { return scValToNative(t); } catch { return t?.toString?.() ?? String(t); }
                });
                const data = v0?.data?.();
                const dataVal = data ? (() => { try { return scValToNative(data); } catch { return String(data); } })() : null;
                out.push(JSON.stringify({ inSuccess, topics, data: dataVal }));
              } catch (err: any) {
                out.push(`(parse-err: ${err?.message ?? err})`);
              }
            }
            if (returnValue) {
              try { out.push(`returnValue=${JSON.stringify(scValToNative(returnValue))}`); } catch {}
            }
            if (out.length > 0 || diagEvents.length > 0 || events.length > 0) {
              return { out, version: v };
            }
          } catch { /* try next version */ }
        }
        return { out, version: null };
      };

      const { out, version } = tryExtractFromMeta(resultMeta);
      diagnosticSummary = out;

      console.error('[SOROBAN] Transaction failed:', getResponse.status);
      console.error('[SOROBAN] meta version detected:', version ?? '(none)');
      console.error('[SOROBAN] meta object keys:', resultMeta ? Object.keys(resultMeta) : 'null');
      console.error('[SOROBAN] meta XDR base64:', metaB64);
      console.error('[SOROBAN] result XDR base64:', resB64);
      console.error('[SOROBAN] Diagnostic events:', diagnosticSummary.length ? diagnosticSummary : '(vacío)');

      sendApiError(req, res, 400, 'SOROBAN_FAILED', `Transaccion blockchain fallida: ${getResponse.status}`);
      return;
    }

    // Extract ticket_root_id from return value. Root id 0 is valid in the
    // contract, so never use 0 as a fallback when parsing fails.
    const returnValue = (getResponse as any).returnValue;
    let ticketRootId: number | null = null;
    if (returnValue) {
      try {
        ticketRootId = parseSorobanU32ReturnValue(scValToNative(returnValue));
      } catch {
        ticketRootId = null;
      }
    }
    if (ticketRootId === null) {
      ticketRootId = parseSorobanU32ReturnValue(returnValue);
    }
    if (ticketRootId === null) {
      console.error('[SOROBAN] Could not parse crear_boleto_para return value:', returnValue?.toString?.() ?? returnValue);
      sendApiError(req, res, 502, 'SOROBAN_BAD_RESPONSE', 'No fue posible leer el identificador on-chain del boleto');
      return;
    }

    const existingOnChainTicket = await prisma.tickets.findFirst({
      where: {
        contract_address: contractAddress,
        ticket_root_id: ticketRootId,
        version: 0,
      },
      select: { id: true },
    });
    if (existingOnChainTicket && existingOnChainTicket.id !== ticketId) {
      console.error(`[SOROBAN] Duplicate on-chain ticket identity contract=${contractAddress} root=${ticketRootId} version=0 current=${ticketId} existing=${existingOnChainTicket.id}`);
      sendApiError(req, res, 409, 'CONFLICT', 'La identidad on-chain del boleto ya está asociada a otro ticket');
      return;
    }

    // Persist the on-chain identity before minting the NFT. This keeps retries
    // from minting a collectible for a ticket identity already owned by another
    // row if the DB unique constraint detects a race or duplicate projection.
    try {
      await prisma.tickets.update({
        where: { id: ticketId },
        data: {
          contract_address: contractAddress,
          ticket_root_id: ticketRootId,
          version: 0,
          owner_wallet: ownerUser.wallet_address,
        },
      });
    } catch (updateErr: any) {
      if (
        updateErr?.code === 'P2002' &&
        Array.isArray(updateErr?.meta?.target) &&
        updateErr.meta.target.includes('contract_address') &&
        updateErr.meta.target.includes('ticket_root_id') &&
        updateErr.meta.target.includes('version')
      ) {
        console.error(`[SOROBAN] Duplicate on-chain ticket identity on update contract=${contractAddress} root=${ticketRootId} version=0 current=${ticketId}`);
        sendApiError(req, res, 409, 'CONFLICT', 'La identidad on-chain del boleto ya está asociada a otro ticket');
        return;
      }
      throw updateErr;
    }

    // Mint el NFT en el ticket_nft_contract del evento (Phase 4.5).
    // El organizer es admin del NFT contract, así que firma el mint server-side.
    // token_id = ticket_root_id (1 NFT por raíz; sobrevive a reventas).
    const nftContractAddress = (event as any).nft_contract_address as string | null;
    let nftMintTxHash: string | null = null;
    let nftTokenId: number | null = null;
    if (nftContractAddress) {
      try {
        const minted = await mintTicketNftWithBump({
          nftContractAddress,
          contractAddress,
          ticketRootId,
          buyerWallet,
        });
        nftMintTxHash = minted.nftMintTxHash;
        nftTokenId = minted.nftTokenId;
        console.log(`[NFT] Minted token_id=${nftTokenId} on ${nftContractAddress.slice(0,8)}… to ${buyerWallet.slice(0,8)}…`);
      } catch (mintErr: any) {
        console.warn('[NFT] mint failed (graceful degradation, ticket still secured):', mintErr?.message);
      }
    } else {
      console.warn(`[NFT] event ${event.id} has no nft_contract_address — skipping NFT mint`);
    }

    if (nftTokenId != null) {
      await prisma.tickets.update({
        where: { id: ticketId },
        data: { nft_token_id: nftTokenId } as any,
      });
    }

    console.log(`[SOROBAN] Ticket secured on-chain! root_id=${ticketRootId}, tx=${sendResponse.hash}`);

    res.json({
      success: true,
      txHash: sendResponse.hash,
      contractAddress,
      ticketRootId,
      chainEventId,
      nftContractAddress,
      nftTokenId,
      nftMintTxHash,
      networkPassphrase: NETWORK_PASSPHRASE,
      network: 'TESTNET',
    });
  } catch (error: any) {
    console.error('[SOROBAN] secure-ticket error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error asegurando ticket en blockchain');
  }
});

// POST /api/transactions/mint-collectible — DEPRECATED (Phase 4.5)
// El mint del NFT ahora ocurre dentro de /secure-ticket via el contrato Soroban
// ticket_nft_contract. Endpoint conservado como no-op idempotente para clientes
// antiguos.
app.post('/api/transactions/mint-collectible', authMiddleware, async (_req, res) => {
  res.json({ success: true, deprecated: true, message: 'Mint NFT ahora se hace en /secure-ticket' });
});

// GET /api/tickets/:id/resale-policy — evidence and limits before listing a ticket
app.get('/api/tickets/:id/resale-policy', authMiddleware, async (req, res) => {
  try {
    const context = await getTicketResaleContext(String(req.params.id), (req as any).userId);
    if (!context) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Ticket no encontrado');
      return;
    }
    res.json(buildTicketResalePolicyResponse(context));
  } catch (error: any) {
    console.error('[RESALE] policy error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error consultando política de reventa');
  }
});

// POST /api/transactions/list-ticket — Build owner-signed XDR to list a ticket for resale on Soroban
app.post('/api/transactions/list-ticket', authMiddleware, async (req, res) => {
  try {
    const { ticketId, price, priceCop } = req.body; // price in XLM stroops (1 XLM = 10_000_000)
    if (!ticketId || !price || price <= 0) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'ticketId y price son requeridos');
      return;
    }
    const requestedPriceAmount = Number(priceCop);
    if (!Number.isFinite(requestedPriceAmount) || requestedPriceAmount <= 0) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'priceCop es requerido para validar la política de reventa');
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: (req as any).userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Debes vincular una wallet antes de listar un ticket');
      return;
    }

    const context = await getTicketResaleContext(String(ticketId));
    const ticket = context?.ticket;
    if (!ticket) { sendApiError(req, res, 404, 'NOT_FOUND', 'Ticket no encontrado'); return; }
    if (ticket.owner_user_id !== (req as any).userId) { sendApiError(req, res, 403, 'FORBIDDEN', 'No autorizado'); return; }
    if (ticket.status !== 'ACTIVE') { sendApiError(req, res, 409, 'CONFLICT', `El ticket no está activo: ${ticket.status}`); return; }
    if (!ticket.contract_address || ticket.ticket_root_id === null) { sendApiError(req, res, 400, 'BAD_REQUEST', 'Ticket no registrado en blockchain'); return; }
    if (ticket.is_for_sale) { sendApiError(req, res, 409, 'CONFLICT', 'Ticket ya está en venta'); return; }
    if (!ticket.owner_wallet || ticket.owner_wallet !== user.wallet_address) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'La wallet vinculada no coincide con el propietario on-chain registrado');
      return;
    }
    const policyResponse = buildTicketResalePolicyResponse(context, requestedPriceAmount);
    if (!policyResponse.canList) {
      sendApiError(req, res, 409, 'CONFLICT', policyResponse.reason ?? 'La reventa no cumple la política del evento');
      return;
    }

    console.log(`[SOROBAN] Building list XDR root_id=${ticket.ticket_root_id}, owner=${user.wallet_address.slice(0, 8)}...`);

    const accountResponse = await sorobanServer.getAccount(user.wallet_address);
    const account = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

    const tx = new TransactionBuilder(account, {
      fee: '10000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: ticket.contract_address,
        function: 'listar_boleto',
        args: [
          nativeToScVal(ticket.ticket_root_id, { type: 'u32' }),
          nativeToScVal(price, { type: 'i128' }),
        ],
      }))
      .setTimeout(60)
      .build();

    const simResponse = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResponse)) {
      const simError = (simResponse as any).error || 'desconocido';
      console.error('[SOROBAN] List simulation failed:', simError);
      sendApiError(req, res, 400, 'SOROBAN_SIMULATION_FAILED', 'No fue posible preparar la firma de reventa');
      return;
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResponse).build();
    const intent = await createTransactionIntent({
      userId: (req as any).userId,
      walletAddress: user.wallet_address,
      operation: 'listar_boleto',
      contractAddress: ticket.contract_address,
      ticketRootId: ticket.ticket_root_id,
      expectedVersion: ticket.version,
      expectedPrice: price,
      xdrHash: transactionHashHex(assembled),
    });
    res.json({ xdr: assembled.toXDR(), networkPassphrase: NETWORK_PASSPHRASE, intentId: intent.id, intentExpiresAt: intent.expires_at });
  } catch (error: any) {
    console.error('[SOROBAN] list-ticket error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error preparando reventa');
  }
});

// POST /api/transactions/cancel-listing — Build owner-signed XDR to cancel a resale listing on Soroban
app.post('/api/transactions/cancel-listing', authMiddleware, async (req, res) => {
  try {
    const { ticketId } = req.body;
    if (!ticketId) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'ticketId es requerido');
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: (req as any).userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Debes vincular una wallet antes de cancelar una reventa');
      return;
    }

    const ticket = await prisma.tickets.findUnique({ where: { id: ticketId } });
    if (!ticket) { sendApiError(req, res, 404, 'NOT_FOUND', 'Ticket no encontrado'); return; }
    if (ticket.owner_user_id !== (req as any).userId) { sendApiError(req, res, 403, 'FORBIDDEN', 'No autorizado'); return; }
    if (!ticket.contract_address || ticket.ticket_root_id === null) { sendApiError(req, res, 400, 'BAD_REQUEST', 'Ticket no registrado en blockchain'); return; }
    if (!ticket.is_for_sale) { sendApiError(req, res, 409, 'CONFLICT', 'Ticket no está en venta'); return; }
    if (!ticket.owner_wallet || ticket.owner_wallet !== user.wallet_address) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'La wallet vinculada no coincide con el propietario on-chain registrado');
      return;
    }

    console.log(`[SOROBAN] Building cancel listing XDR root_id=${ticket.ticket_root_id}, owner=${user.wallet_address.slice(0, 8)}...`);

    const accountResponse = await sorobanServer.getAccount(user.wallet_address);
    const account = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

    const tx = new TransactionBuilder(account, {
      fee: '10000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: ticket.contract_address,
        function: 'cancelar_venta',
        args: [
          nativeToScVal(ticket.ticket_root_id, { type: 'u32' }),
        ],
      }))
      .setTimeout(60)
      .build();

    const simResponse = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResponse)) {
      const simError = (simResponse as any).error || 'desconocido';
      console.error('[SOROBAN] Cancel listing simulation failed:', simError);
      sendApiError(req, res, 400, 'SOROBAN_SIMULATION_FAILED', 'No fue posible preparar la firma de cancelación');
      return;
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResponse).build();
    const intent = await createTransactionIntent({
      userId: (req as any).userId,
      walletAddress: user.wallet_address,
      operation: 'cancelar_venta',
      contractAddress: ticket.contract_address,
      ticketRootId: ticket.ticket_root_id,
      expectedVersion: ticket.version,
      xdrHash: transactionHashHex(assembled),
    });
    res.json({ xdr: assembled.toXDR(), networkPassphrase: NETWORK_PASSPHRASE, intentId: intent.id, intentExpiresAt: intent.expires_at });
  } catch (error: any) {
    console.error('[SOROBAN] cancel-listing error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error preparando cancelacion de reventa');
  }
});

// POST /api/transactions/build-buy-xdr — Build unsigned XDR for comprar_boleto (Freighter signs)
app.post('/api/transactions/build-buy-xdr', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { contractAddress, ticketRootId, buyerPublicKey } = req.body;
    if (!contractAddress || ticketRootId === undefined || !buyerPublicKey) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'contractAddress, ticketRootId y buyerPublicKey son requeridos');
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Debes vincular una wallet antes de construir una transacción');
      return;
    }
    if (buyerPublicKey !== user.wallet_address) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'buyerPublicKey no coincide con la wallet vinculada al usuario');
      return;
    }

    // Verify ticket is listed
    const ticket = await prisma.tickets.findFirst({
      where: { contract_address: contractAddress, ticket_root_id: ticketRootId, is_for_sale: true, status: 'ACTIVE' },
    });
    if (!ticket) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Ticket no está en venta');
      return;
    }

    console.log(`[SOROBAN] Building buy XDR for root_id=${ticketRootId}, buyer=${buyerPublicKey.slice(0, 8)}...`);

    const accountResponse = await sorobanServer.getAccount(buyerPublicKey);
    const account = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

    const tx = new TransactionBuilder(account, {
      fee: '10000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: contractAddress,
        function: 'comprar_boleto',
        args: [
          nativeToScVal(ticketRootId, { type: 'u32' }),
          new Address(buyerPublicKey).toScVal(),
        ],
      }))
      .setTimeout(60)
      .build();

    // Simulate to get footprint and auth entries
    const simResponse = await sorobanServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResponse)) {
      const simError = (simResponse as any).error || 'desconocido';
      console.error('[SOROBAN] Buy simulation failed:', simError);
      // Parse common errors for user-friendly messages
      if (simError.includes('not within the allowed range') || simError.includes('balance')) {
        sendApiError(req, res, 400, 'BAD_REQUEST', 'Saldo insuficiente en tu billetera Stellar. Necesitas más XLM para completar la compra.');
        return;
      }
      if (simError.includes('#8')) {
        sendApiError(req, res, 400, 'BAD_REQUEST', 'No puedes comprar tu propio boleto');
        return;
      }
      sendApiError(req, res, 400, 'SOROBAN_SIMULATION_FAILED', 'No fue posible preparar la firma de compra');
      return;
    }

    // Assemble but do NOT sign — frontend signs with Freighter
    const assembled = SorobanRpc.assembleTransaction(tx, simResponse).build();
    const xdrBase64 = assembled.toXDR();
    const intent = await createTransactionIntent({
      userId,
      walletAddress: buyerPublicKey,
      operation: 'comprar_boleto',
      contractAddress: String(contractAddress),
      ticketRootId: Number(ticketRootId),
      expectedVersion: ticket.version,
      expectedPrice: ticket.resale_price,
      xdrHash: transactionHashHex(assembled),
    });

    console.log(`[SOROBAN] XDR built for buy, ${xdrBase64.length} chars`);
    res.json({ xdr: xdrBase64, networkPassphrase: NETWORK_PASSPHRASE, intentId: intent.id, intentExpiresAt: intent.expires_at });
  } catch (error: any) {
    console.error('[SOROBAN] build-buy-xdr error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error preparando compra de reventa');
  }
});

// POST /api/transactions/submit — Submit Freighter-signed XDR to Soroban
app.post('/api/transactions/submit', transactionRateLimit, authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { signedXdr, intentId } = req.body;
    if (!signedXdr || !intentId) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'signedXdr e intentId son requeridos');
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Debes vincular una wallet antes de enviar una transaccion');
      return;
    }

    const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    if (tx instanceof FeeBumpTransaction) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Las transacciones fee-bump no estan soportadas en este endpoint');
      return;
    }
    if (tx.source !== user.wallet_address) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'La transaccion firmada no corresponde a la wallet vinculada al usuario');
      return;
    }

    const intent = await prisma.transaction_intents.findUnique({
      where: { id: String(intentId) },
      select: {
        id: true,
        user_id: true,
        wallet_address: true,
        operation: true,
        contract_address: true,
        ticket_root_id: true,
        expected_version: true,
        expected_price: true,
        xdr_hash: true,
        status: true,
        expires_at: true,
        submitted_at: true,
      },
    });
    const intentDecision = authorizeTransactionIntentSubmit({
      intent,
      userId,
      walletAddress: user.wallet_address,
      signedXdrHash: transactionHashHex(tx),
    });
    if (!intentDecision.ok) {
      if (intentDecision.markExpired && intent) {
        await prisma.transaction_intents.update({
          where: { id: intent.id },
          data: { status: 'EXPIRED' },
        });
      }
      sendApiError(req, res, intentDecision.status, codeForStatus(intentDecision.status), intentDecision.error);
      return;
    }
    if (!intent) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Intencion de transaccion no encontrada');
      return;
    }

    const currentTicket = await prisma.tickets.findFirst({
      where: {
        contract_address: intent.contract_address,
        ticket_root_id: intent.ticket_root_id,
        version: intent.expected_version,
      },
      select: {
        contract_address: true,
        ticket_root_id: true,
        version: true,
        owner_wallet: true,
        status: true,
        is_for_sale: true,
        resale_price: true,
      },
    });
    const currentStateDecision = authorizeTransactionIntentCurrentState({
      intent,
      ticket: currentTicket,
      walletAddress: user.wallet_address,
    });
    if (!currentStateDecision.ok) {
      sendApiError(req, res, currentStateDecision.status, codeForStatus(currentStateDecision.status), currentStateDecision.error);
      return;
    }

    const sendResponse = await sorobanServer.sendTransaction(tx);
    if (sendResponse.status === 'ERROR') {
      console.error('[SOROBAN] Submit failed:', sendResponse);
      await prisma.transaction_intents.update({
        where: { id: String(intentId) },
        data: { status: 'FAILED' },
      });
      sendApiError(req, res, 400, 'SOROBAN_REJECTED', 'La red rechazo la transaccion firmada');
      return;
    }

    let getResponse: SorobanRpc.Api.GetTransactionResponse;
    let attempts = 0;
    do {
      await new Promise((r) => setTimeout(r, 2000));
      getResponse = await sorobanServer.getTransaction(sendResponse.hash);
      attempts++;
    } while (getResponse.status === 'NOT_FOUND' && attempts < 30);

    if (getResponse.status !== 'SUCCESS') {
      await prisma.transaction_intents.update({
        where: { id: String(intentId) },
        data: { status: 'FAILED', tx_hash: sendResponse.hash },
      });
      sendApiError(req, res, 400, 'SOROBAN_FAILED', `Transaccion fallida: ${getResponse.status}`);
      return;
    }

    await prisma.transaction_intents.update({
      where: { id: String(intentId) },
      data: { status: 'SUBMITTED', submitted_at: new Date(), tx_hash: sendResponse.hash },
    });

    console.log(`[SOROBAN] Signed tx submitted! hash=${sendResponse.hash}`);
    res.json({ success: true, txHash: sendResponse.hash });
  } catch (error: any) {
    console.error('[SOROBAN] submit error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error enviando transaccion');
  }
});

// POST /api/transactions/transfer-nft — transferencia del collectible NFT
// solo despues de una reventa confirmada por el indexer/onchain_events.
app.post('/api/transactions/transfer-nft', transactionRateLimit, authMiddleware, async (req, res) => {
  try {
    if (!organizerKeypair) {
      sendApiError(req, res, 503, 'BLOCKCHAIN_NOT_CONFIGURED', 'Blockchain no configurada'); return;
    }
    const userId = (req as any).userId;
    const { contractAddress, ticketRootId, buyerWallet, txHash, expectedVersion } = req.body;
    if (!contractAddress || ticketRootId === undefined || !buyerWallet || !txHash || expectedVersion === undefined) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'contractAddress, ticketRootId, buyerWallet, txHash y expectedVersion son requeridos'); return;
    }

    const authorization = await authorizeVerifiedNftTransfer(
      {
        userId,
        contractAddress: String(contractAddress),
        ticketRootId: Number(ticketRootId),
        buyerWallet: String(buyerWallet),
        txHash: String(txHash),
        expectedVersion: Number(expectedVersion),
      },
      {
        getUserWallet: async (id) => {
          const user = await prisma.users.findUnique({ where: { id }, select: { wallet_address: true } });
          return user?.wallet_address ?? null;
        },
        getNftContractAddress: async (address) => {
          const event = await prisma.events.findFirst({
            where: { contract_address: address },
            select: { nft_contract_address: true } as any,
          });
          return ((event as any)?.nft_contract_address as string | null | undefined) ?? null;
        },
        getActiveTicketVersion: async (input) => {
          const ticket = await prisma.tickets.findFirst({
            where: {
              contract_address: input.contractAddress,
              ticket_root_id: input.ticketRootId,
              owner_wallet: input.ownerWallet,
              status: 'ACTIVE',
              version: input.version,
            },
            select: { version: true },
          });
          return ticket?.version ?? null;
        },
        getProcessedResaleEvent: async (input) => {
          const resaleEvent = await prisma.onchain_events.findFirst({
            where: {
              tx_hash: input.txHash,
              contract_address: input.contractAddress,
              event_name: 'boleto_revendido',
              ticket_root_id: input.ticketRootId,
              version: input.version,
              status: 'PROCESSED',
            },
            orderBy: { processed_at: 'desc' },
            select: { payload: true },
          });
          return resaleEvent ? { payload: resaleEvent.payload as any } : null;
        },
      },
    );
    if (!authorization.ok) {
      sendApiError(req, res, authorization.status, codeForStatus(authorization.status), authorization.error);
      return;
    }

    try {
      const result = await burnAndMintResaleNft({
        nftContractAddress: authorization.nftContractAddress,
        contractAddress: String(contractAddress),
        ticketRootId: Number(ticketRootId),
        buyerWallet: String(buyerWallet),
      });
      console.log(
        `[NFT] verified burn+mint root=${ticketRootId} v${authorization.version} token=${result.nftTokenId} -> ${String(buyerWallet).slice(0, 8)}...`
      );
      res.json({
        success: true,
        alreadyTransferred: result.alreadyTransferred ?? false,
        burnTxHash: result.burnTxHash,
        mintTxHash: result.mintTxHash,
        txHash: result.mintTxHash,
        nftTokenId: result.nftTokenId,
        nftContractAddress: authorization.nftContractAddress,
      });
    } catch (e: any) {
      if (e?.status === 409) {
        sendApiError(req, res, 409, 'CONFLICT', e.message);
        return;
      }
      throw e;
    }
  } catch (error: any) {
    console.error('[NFT] transfer burn+mint error:', error?.message ?? error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error transfiriendo NFT');
  }
});

// GET /api/nft/metadata/:nftContractAddress/:tokenId — JSON SEP-39 metadata
// que el contrato NFT referencia vía token_uri. Wallets compatibles
// (Lobstr, futuras versiones de Freighter) lo descargan para mostrar nombre,
// descripción e imagen (el QR del boleto).
app.get('/api/nft/metadata/:nftContractAddress/:tokenId', async (req, res) => {
  try {
    const { nftContractAddress, tokenId } = req.params;
    const event = await cached(`nft:metadata:event:${nftContractAddress}`, 3_600_000, () =>
      prisma.events.findFirst({
        where: { nft_contract_address: nftContractAddress } as any,
        select: { title: true, starts_at: true, contract_address: true, slug: true } as any,
      })
    );
    if (!event) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'NFT contract no encontrado');
      return;
    }
    const evAny = event as any;
    const startsAt = evAny.starts_at ? new Date(evAny.starts_at).toISOString().slice(0, 10) : '';
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      name: `Boleto — ${evAny.title}`,
      description:
        `Boleto NFT del evento "${evAny.title}"${startsAt ? ` (${startsAt})` : ''}. ` +
        `Escanea el QR del coleccionable en puerta para validar tu acceso.`,
      image: `${PUBLIC_BASE_URL}/api/nft/qr/${nftContractAddress}/${tokenId}.png`,
      attributes: [
        { trait_type: 'Evento', value: evAny.title },
        ...(startsAt ? [{ trait_type: 'Fecha', value: startsAt }] : []),
        { trait_type: 'Contrato Evento', value: evAny.contract_address ?? '' },
        { trait_type: 'Token ID', value: Number(tokenId) },
      ],
    });
  } catch (error: any) {
    console.error('[NFT metadata] error:', error?.message);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error generando metadata');
  }
});

// GET /api/nft/qr/:contractAddress/:tokenId.png — PNG estático por nft_token_id.
// El QR queda ligado al snapshot de versión y owner_wallet que recibió ese NFT.
app.get('/api/nft/qr/:nftContractAddress/:tokenIdRaw', async (req, res) => {
  try {
    const { nftContractAddress, tokenIdRaw } = req.params;
    const tokenId = Number(tokenIdRaw.replace(/\.png$/i, ''));
    if (!Number.isFinite(tokenId) || tokenId < 0) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'tokenId invalido');
      return;
    }
    const cacheKey = `nft:${nftContractAddress}:${tokenId}`;
    if (!qrCache.has(cacheKey)) {
      const event = await cached(`nft:qr:event:${nftContractAddress}`, 3_600_000, () =>
        prisma.events.findFirst({
          where: { nft_contract_address: nftContractAddress } as any,
          select: { id: true, contract_address: true } as any,
        })
      );
      const eventContract = (event as any)?.contract_address as string | null | undefined;
      if (!eventContract) {
        sendApiError(req, res, 404, 'NOT_FOUND', 'NFT contract no encontrado');
        return;
      }
      const ticket = await cached(`nft:qr:ticket:${eventContract}:${tokenId}`, 3_600_000, () =>
        prisma.tickets.findFirst({
          where: {
            contract_address: eventContract,
            nft_token_id: tokenId,
          } as any,
          select: { ticket_root_id: true, version: true, owner_wallet: true } as any,
        })
      );
      if (!ticket || (ticket as any).ticket_root_id == null || (ticket as any).version == null) {
        sendApiError(req, res, 404, 'NOT_FOUND', 'NFT token no encontrado');
        return;
      }
      const buf = await buildTicketQrPng(buildSignedTicketQrPayload({
        contractAddress: eventContract,
        ticketRootId: (ticket as any).ticket_root_id,
        version: (ticket as any).version,
        eventId: (event as any).id,
        ownerWallet: (ticket as any).owner_wallet ?? null,
      }));
      qrCache.set(cacheKey, buf);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Content-Type', 'image/png');
    res.send(qrCache.get(cacheKey)!);
  } catch (err: any) {
    console.error('[NFT qr] error:', err?.message);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error generando QR');
  }
});

// POST /api/transactions/submit-classic — Submit a Freighter-signed CLASSIC tx
// (e.g. CHANGE_TRUST for the collectible) to Horizon, not Soroban RPC.
app.post('/api/transactions/submit-classic', transactionRateLimit, authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { signedXdr } = req.body;
    if (!signedXdr) { sendApiError(req, res, 400, 'BAD_REQUEST', 'signedXdr es requerido'); return; }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Debes vincular una wallet antes de enviar una transacción');
      return;
    }

    const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    if (tx instanceof FeeBumpTransaction) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Fee-bump no soportado'); return;
    }
    if (tx.source !== user.wallet_address) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'La transacción no corresponde a tu wallet');
      return;
    }

    const result = await horizonServer.submitTransaction(tx);
    res.json({ success: true, txHash: (result as any).hash });
  } catch (error: any) {
    const data = error?.response?.data;
    console.error('[CLASSIC] submit error:', data ?? error?.message);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error enviando transacción clásica');
  }
});

// --- ADMIN ENDPOINTS (Restringido) ---
app.get('/api/admin/venues', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const venues = await prisma.venues.findMany({ include: { venue_sections: true } });
    res.json(venues.map(v => ({
      id: v.id,
      name: v.name,
      type: v.venue_type,
      address: v.address_line,
      sections: v.venue_sections.map(s => ({
        id: s.id,
        name: s.section_name,
        capacity: s.capacity
      }))
    })));
  } catch (error: any) {
    console.error('[ADMIN] Venues error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo venues');
  }
});

// POST /api/admin/scan — Redeem a ticket
app.post('/api/admin/scan', scannerRateLimit, authMiddleware, async (req, res) => {
  try {
    const user = (req as any).authUser ?? await prisma.users.findUnique({ where: { id: (req as any).userId } });
    const roleDecision = authorizeScannerRole(user?.role);
    if (roleDecision) {
      sendApiError(req, res, roleDecision.status, codeForStatus(roleDecision.status), roleDecision.error);
      return;
    }
    const verifierUserId = (req as any).userId as string;
    let checkinPayload = buildCheckinPayloadSummary(req.body);

    // Production scanner accepts signed QR tokens. Legacy ticketId scanning is
    // available only when explicitly enabled for demo/dev fixtures.
    const scanRequest = parseScanRequest(req.body, {
      qrSecret: QR_SIGNING_SECRET,
      allowLegacyTicketId: ALLOW_LEGACY_TICKET_ID_SCAN,
    });
    if ('ok' in scanRequest) {
      sendApiError(req, res, scanRequest.status, codeForStatus(scanRequest.status), scanRequest.error);
      return;
    }

    let ticket = null as Awaited<ReturnType<typeof prisma.tickets.findUnique>> | null;
    let requestedVersion: number | undefined;

    if (scanRequest.kind === 'ticketId') {
      ticket = await prisma.tickets.findUnique({ where: { id: scanRequest.ticketId } });
      checkinPayload = summarizeScanRequest({ kind: 'ticketId', ticketId: scanRequest.ticketId });
    } else {
      requestedVersion = scanRequest.version;
      checkinPayload = summarizeScanRequest(scanRequest);
      const event = await prisma.events.findFirst({
        where: {
          id: scanRequest.eventId,
          contract_address: scanRequest.contractAddress,
        } as any,
        select: { id: true } as any,
      });
      if (!event) {
        await recordCheckin({
          verifierUserId,
          result: 'DENIED',
          reason: 'QR no corresponde al evento del contrato',
          payload: checkinPayload,
        }).catch((auditError) => console.error('[SCAN] Checkin audit error:', auditError));
        sendApiError(req, res, 409, 'CONFLICT', 'QR no corresponde al evento del contrato');
        return;
      }
      // Resolve the latest version for this root. Status is checked below so
      // duplicate scans return 409 instead of looking like a missing ticket.
      ticket = await prisma.tickets.findFirst({
        where: {
          contract_address: scanRequest.contractAddress,
          ticket_root_id: scanRequest.ticketRootId,
        },
        orderBy: { version: 'desc' },
      });
    }

    const scanDecision = evaluateScanTicket(
      ticket
        ? {
            id: ticket.id,
            status: ticket.status,
            version: (ticket as any).version ?? null,
            ownerWallet: (ticket as any).owner_wallet ?? null,
          }
        : null,
      requestedVersion,
      scanRequest.kind === 'contractTicket' ? scanRequest.ownerWallet : null,
    );
    if (!scanDecision.ok) {
      await recordCheckin({
        verifierUserId,
        ticketId: ticket?.id ?? null,
        result: 'DENIED',
        reason: scanDecision.error,
        payload: checkinPayload,
      }).catch((auditError) => console.error('[SCAN] Checkin audit error:', auditError));
      sendApiError(req, res, scanDecision.status, codeForStatus(scanDecision.status), scanDecision.error);
      return;
    }

    // Gate scan is DB-only for thesis demo speed. Soroban redemption is handled
    // only when the indexer receives a boleto_redimido event from an on-chain flow.
    await prisma.$transaction([
      prisma.tickets.update({
        where: { id: scanDecision.ticketId },
        data: { status: 'USED', used_at: new Date(), is_for_sale: false, lifecycle_reason: 'REDEEMED_DB_SCAN' },
      }),
      prisma.checkins.create({
        data: {
          verifier_user_id: verifierUserId,
          ticket_id: scanDecision.ticketId,
          result: 'ALLOWED',
          source: 'db',
          payload: checkinPayload,
        },
      }),
    ]);

    res.json({ success: true, message: 'Boleto validado y marcado como usado' });
  } catch (error: any) {
    console.error('[SCAN] Error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del scanner');
  }
});

// GET /api/admin/contracts
app.get('/api/admin/contracts', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (!user || user.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const factoryId = process.env.ORGANIZER_PUBLIC || 'GBM6N2SUCK3Y6I5DHQKULZD3W27EYMU37VYHNKWLVBNS6VYZHRJPWJBT';
    
    // Fetch events that have a deployed contract
    const deployedEvents = await prisma.events.findMany({
      where: { contract_address: { not: null } },
      select: {
        id: true,
        title: true,
        contract_address: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      factoryContractId: factoryId,
      events: deployedEvents
    });
  } catch (error: any) {
    console.error('[ADMIN] Contracts error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo contratos');
  }
});

app.get('/api/admin/events', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const events = await prisma.events.findMany({
      include: eventIncludes,
      orderBy: { created_at: 'desc' }
    });
    res.json(events.map(toEventDto));
  } catch (error: any) {
    console.error('[ADMIN] Events error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo eventos admin');
  }
});

app.get('/api/admin/events/:id/resale-policy', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const event = await prisma.events.findUnique({
      where: { id: String(req.params.id) },
      include: { event_resale_policies: true },
    });
    if (!event) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Evento no encontrado');
      return;
    }

    res.json(formatAdminResalePolicy(event.id, event.event_resale_policies));
  } catch (error: any) {
    console.error('[ADMIN] Get resale policy error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo política de reventa');
  }
});

app.patch('/api/admin/events/:id/resale-policy', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const eventId = String(req.params.id);
    const event = await prisma.events.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Evento no encontrado');
      return;
    }

    let data: ReturnType<typeof buildAdminResalePolicyInput>;
    try {
      data = buildAdminResalePolicyInput(req.body);
    } catch (validationError: any) {
      sendApiError(req, res, 400, 'BAD_REQUEST', validationError.message || 'Política de reventa inválida');
      return;
    }

    const policy = await prisma.event_resale_policies.upsert({
      where: { event_id: eventId },
      update: data as any,
      create: {
        event_id: eventId,
        ...data,
      } as any,
    });

    res.json(formatAdminResalePolicy(eventId, policy));
  } catch (error: any) {
    console.error('[ADMIN] Update resale policy error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error actualizando política de reventa');
  }
});

app.post('/api/admin/events', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const { title, slug, category_id, date, venue_id, sections, cover_image_url } = req.body;
    
    // Hardcode organizer for MVP
    const organizer = await prisma.organizers.findFirst();
    const firstCat = await prisma.event_categories.findFirst();

    const newEvent = await prisma.events.create({
      data: {
        title,
        slug,
        category_id: category_id || firstCat?.id || 'cat-1-concert',
        status: 'PUBLISHED',
        starts_at: new Date(date),
        ends_at: new Date(new Date(date).getTime() + 4 * 60 * 60 * 1000), // +4 horas
        organizer_id: organizer!.id,
        venue_id: venue_id,
        cover_image_url: typeof cover_image_url === 'string' && cover_image_url.length > 0 ? cover_image_url : null,
      }
    });

    if (sections && Array.isArray(sections)) {
      for (const s of sections) {
        await prisma.event_ticket_types.create({
          data: {
            event_id: newEvent.id,
            // Admin quick-create models section names as general-admission
            // ticket types. Assigned seating inventory is managed separately.
            venue_section_id: null,
            ticket_type_name: s.name,
            description: `Boleto habilitado para ${s.name}`,
            price_amount: s.price || 0,
            service_fee_amount: (s.price || 0) * 0.10, // 10% fee
            inventory_quantity: s.capacity,
            is_active: true,
          }
        });
      }
    }

    invalidateCache('events:');
    res.json({ success: true, eventId: newEvent.id });
  } catch (error: any) {
    console.error('[ADMIN] Create event error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error creando evento');
  }
});

app.post('/api/admin/events/:id/deploy', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado'); return; }

    const eventId = req.params.id as string;
    const event = await prisma.events.findUnique({
      where: { id: eventId },
      select: { id: true, contract_address: true },
    });
    const soldTicketsCount = await prisma.tickets.count({
      where: {
        order_items: {
          event_ticket_types: { event_id: eventId },
        },
      },
    });
    const deployDecision = authorizeSingleEventDeploy({ event, soldTicketsCount });
    if (!deployDecision.ok) {
      sendApiError(req, res, deployDecision.status, codeForStatus(deployDecision.status), deployDecision.error);
      return;
    }

    // Run the Soroban deploy script for this event only. It must not clear or
    // redeploy contracts for other published events.
    const { stdout, stderr } = await execPromise('npx tsx scripts/deploy-contracts.ts', {
      cwd: require('path').resolve(__dirname, '..'),
      env: { ...process.env, DEPLOY_EVENT_ID: eventId },
    });
    console.log(`[ADMIN] Deploy Output:\n${stdout}`);
    if (stderr) console.error(`[ADMIN] Deploy Stderr:\n${stderr}`);

    // Wait to let prisma updates settle
    await new Promise(r => setTimeout(r, 2000));
    
    const updatedEvent = await prisma.events.findUnique({ where: { id: eventId } });
    res.json({ 
      success: !!updatedEvent?.contract_address, 
      contractAddress: updatedEvent?.contract_address,
      log: stdout || ''
    });
  } catch (error: any) {
    console.error('[ADMIN] Deploy event error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error desplegando contrato del evento');
  }
});

// --- AUTH ENDPOINTS ---
app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Email y contraseña son requeridos');
      return;
    }

    const user = await prisma.users.findFirst({ where: { email } });
    if (!user) {
      sendApiError(req, res, 401, 'UNAUTHORIZED', 'Credenciales inválidas');
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      sendApiError(req, res, 401, 'UNAUTHORIZED', 'Credenciales inválidas');
      return;
    }

    // Update last login
    await prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } });

    const accessToken = jwt.sign({ userId: user.id }, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ accessToken, user: toUserDto(user) });
  } catch (error: any) {
    console.error('[AUTH] Login error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
});

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    const { firstName, lastName, email, password, documentType, documentNumber, phone } = req.body;
    if (!firstName || !email || !password || !documentNumber) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Campos requeridos: firstName, email, password, documentNumber');
      return;
    }

    // Check if email already exists
    const existing = await prisma.users.findFirst({ where: { email } });
    if (existing) {
      sendApiError(req, res, 409, 'CONFLICT', 'Ya existe una cuenta con ese correo electrónico');
      return;
    }

    const normalizedDocumentType = documentType || 'CC';
    const existingDocument = await prisma.users.findFirst({
      where: { document_type: normalizedDocumentType, document_number: documentNumber, deleted_at: null },
    });
    if (existingDocument) {
      sendApiError(req, res, 409, 'CONFLICT', 'Ya existe una cuenta con ese documento de identidad');
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.create({
      data: {
        first_name: firstName,
        last_name: lastName || '',
        email,
        password_hash,
        document_type: normalizedDocumentType,
        document_number: documentNumber,
        phone: phone || null,
      },
    });

    const accessToken = jwt.sign({ userId: user.id }, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ accessToken, user: toUserDto(user) });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const target = Array.isArray(error?.meta?.target) ? error.meta.target.join(',') : String(error?.meta?.target ?? '');
      const message = target.includes('document')
        ? 'Ya existe una cuenta con ese documento de identidad'
        : 'Ya existe una cuenta con esos datos';
      sendApiError(req, res, 409, 'CONFLICT', message);
      return;
    }
    console.error('[AUTH] Register error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
});

app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (!user) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Usuario no encontrado');
      return;
    }
    res.json(toUserDto(user));
  } catch (error: any) {
    console.error('[AUTH] Me error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
});

// PATCH /api/users/me — update profile
app.patch('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const { firstName, lastName, phone, documentType, documentNumber } = req.body;
    const user = await prisma.users.update({
      where: { id: (req as any).userId },
      data: {
        ...(firstName !== undefined && { first_name: firstName }),
        ...(lastName !== undefined && { last_name: lastName }),
        ...(phone !== undefined && { phone }),
        ...(documentType !== undefined && { document_type: documentType }),
        ...(documentNumber !== undefined && { document_number: documentNumber }),
      },
    });
    res.json(toUserDto(user));
  } catch (error: any) {
    console.error('[AUTH] Update profile error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
});

// POST /api/wallet/challenge — issue a short-lived message to prove wallet ownership
app.post('/api/wallet/challenge', walletRateLimit, authMiddleware, async (req, res) => {
  try {
    if ((req as any).authUser?.role !== 'CUSTOMER') {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Las cuentas operativas no pueden vincular wallet');
      return;
    }
    const walletAddress = String(req.body?.walletAddress ?? '').trim();
    if (!walletAddress) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'walletAddress requerido');
      return;
    }

    const challenge = createWalletChallenge({
      userId: (req as any).userId,
      walletAddress,
    });
    if ('ok' in challenge) {
      sendApiError(req, res, challenge.status, codeForStatus(challenge.status), challenge.error);
      return;
    }

    const row = await prisma.wallet_challenges.create({
      data: {
        user_id: (req as any).userId,
        wallet_address: walletAddress,
        nonce: challenge.nonce,
        message: challenge.message,
        expires_at: challenge.expiresAt,
      },
      select: { id: true, message: true, expires_at: true },
    });

    res.status(201).json({
      challengeId: row.id,
      message: row.message,
      expiresAt: row.expires_at,
    });
  } catch (error: any) {
    console.error('[AUTH] Wallet challenge error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
});

// PATCH /api/users/me/wallet — link Freighter wallet to user account after signature proof
app.patch('/api/users/me/wallet', walletRateLimit, authMiddleware, async (req, res) => {
  try {
    if ((req as any).authUser?.role !== 'CUSTOMER') {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Las cuentas operativas no pueden vincular wallet');
      return;
    }
    const walletAddress = String(req.body?.walletAddress ?? '').trim();
    const challengeId = String(req.body?.challengeId ?? '').trim();
    const signature = String(req.body?.signature ?? '').trim();
    if (!walletAddress || !challengeId || !signature) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'walletAddress, challengeId y signature son requeridos');
      return;
    }

    const challenge = await prisma.wallet_challenges.findFirst({
      where: {
        id: challengeId,
        user_id: (req as any).userId,
        wallet_address: walletAddress,
      },
      select: {
        id: true,
        message: true,
        expires_at: true,
        consumed_at: true,
      },
    });

    if (!challenge) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Challenge de wallet no encontrado');
      return;
    }

    const verification = verifyWalletChallengeSignature({
      walletAddress,
      message: challenge.message,
      signature,
      expiresAt: challenge.expires_at,
      consumedAt: challenge.consumed_at,
    });
    if (!verification.ok) {
      sendApiError(req, res, verification.status, codeForStatus(verification.status), verification.error);
      return;
    }

    const user = await prisma.$transaction(async (tx) => {
      await tx.wallet_challenges.update({
        where: { id: challenge.id },
        data: { consumed_at: new Date() },
      });
      return tx.users.update({
        where: { id: (req as any).userId },
        data: { wallet_address: walletAddress },
      });
    });

    res.json({ walletAddress: user.wallet_address });
  } catch (error: any) {
    if (error.code === 'P2002') {
      sendApiError(req, res, 409, 'CONFLICT', 'Wallet ya vinculada a otra cuenta');
      return;
    }
    console.error('[AUTH] Link wallet error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  }
});

// --- PQR / CLAIMS ENDPOINTS ---

app.get('/api/claims', authMiddleware, async (req, res) => {
  try {
    const claims = await prisma.pqr_claims.findMany({
      where: { user_id: (req as any).userId },
      orderBy: { created_at: 'desc' },
      include: claimIncludes,
    });
    res.json(claims.map(formatClaim));
  } catch (error: any) {
    console.error('[PQR] List user claims error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo reclamos');
  }
});

app.post('/api/claims', authMiddleware, async (req, res) => {
  try {
    const type = String(req.body?.type ?? '').trim();
    const subject = String(req.body?.subject ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const ticketId = req.body?.ticketId ? String(req.body.ticketId).trim() : null;
    const orderId = req.body?.orderId ? String(req.body.orderId).trim() : null;
    const eventId = req.body?.eventId ? String(req.body.eventId).trim() : null;
    const relatedTxHash = req.body?.relatedTxHash ? String(req.body.relatedTxHash).trim() : null;

    if (!isPqrClaimType(type)) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Tipo de reclamo inválido');
      return;
    }
    if (!subject || !description) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'subject y description son requeridos');
      return;
    }
    if (!ticketId && !orderId && !eventId && !relatedTxHash) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'El reclamo debe asociarse a ticket, orden, evento o transacción');
      return;
    }

    const evidenceResult = await buildPqrEvidence({
      userId: (req as any).userId,
      ticketId,
      orderId,
      eventId,
      relatedTxHash,
    });
    if (!evidenceResult.ok) {
      sendApiError(req, res, evidenceResult.status, codeForStatus(evidenceResult.status), evidenceResult.error);
      return;
    }

    const claim = await prisma.$transaction(async (tx) => {
      const created = await tx.pqr_claims.create({
        data: {
          user_id: (req as any).userId,
          type: type as any,
          subject,
          description,
          ticket_id: evidenceResult.ticketId,
          order_id: evidenceResult.orderId,
          event_id: evidenceResult.eventId,
          related_tx_hash: relatedTxHash,
          evidence: evidenceResult.evidence as any,
        },
      });
      await tx.pqr_claim_messages.create({
        data: {
          claim_id: created.id,
          author_id: (req as any).userId,
          message: description,
        },
      });
      return tx.pqr_claims.findUniqueOrThrow({ where: { id: created.id }, include: claimIncludes });
    });

    res.status(201).json(formatClaim(claim));
  } catch (error: any) {
    console.error('[PQR] Create claim error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error creando reclamo');
  }
});

app.get('/api/claims/:id', authMiddleware, async (req, res) => {
  try {
    const claim = await prisma.pqr_claims.findUnique({ where: { id: String(req.params.id) }, include: claimIncludes });
    if (!claim) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Reclamo no encontrado');
      return;
    }
    if (!canUserAccessClaim({ role: (req as any).authUser?.role, userId: (req as any).userId, claimUserId: claim.user_id })) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'No autorizado');
      return;
    }
    res.json(formatClaim(claim));
  } catch (error: any) {
    console.error('[PQR] Get claim error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo reclamo');
  }
});

app.post('/api/claims/:id/messages', authMiddleware, async (req, res) => {
  try {
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'message es requerido');
      return;
    }
    const claim = await prisma.pqr_claims.findUnique({ where: { id: String(req.params.id) } });
    if (!claim) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Reclamo no encontrado');
      return;
    }
    if (!canUserAccessClaim({ role: (req as any).authUser?.role, userId: (req as any).userId, claimUserId: claim.user_id })) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'No autorizado');
      return;
    }
    await prisma.pqr_claim_messages.create({
      data: {
        claim_id: claim.id,
        author_id: (req as any).userId,
        message,
      },
    });
    const updated = await prisma.pqr_claims.findUniqueOrThrow({ where: { id: claim.id }, include: claimIncludes });
    res.status(201).json(formatClaim(updated));
  } catch (error: any) {
    console.error('[PQR] Add message error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error agregando mensaje');
  }
});

app.get('/api/admin/claims', authMiddleware, async (req, res) => {
  try {
    if (!isInternalClaimRole((req as any).authUser?.role)) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado');
      return;
    }
    const status = req.query.status ? String(req.query.status) : null;
    const type = req.query.type ? String(req.query.type) : null;
    if (status && !isPqrClaimStatus(status)) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Estado de reclamo inválido');
      return;
    }
    if (type && !isPqrClaimType(type)) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Tipo de reclamo inválido');
      return;
    }
    const claims = await prisma.pqr_claims.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(type ? { type: type as any } : {}),
        ...(req.query.eventId ? { event_id: String(req.query.eventId) } : {}),
        ...(req.query.userId ? { user_id: String(req.query.userId) } : {}),
      },
      orderBy: { created_at: 'desc' },
      include: claimIncludes,
    });
    res.json(claims.map(formatClaim));
  } catch (error: any) {
    console.error('[PQR] Admin list claims error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo reclamos');
  }
});

app.patch('/api/admin/claims/:id', authMiddleware, async (req, res) => {
  try {
    if (!isInternalClaimRole((req as any).authUser?.role)) {
      sendApiError(req, res, 403, 'FORBIDDEN', 'Acceso denegado');
      return;
    }
    const claim = await prisma.pqr_claims.findUnique({ where: { id: String(req.params.id) } });
    if (!claim) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Reclamo no encontrado');
      return;
    }

    const status = req.body?.status ? String(req.body.status).trim() : null;
    const assignedToUserId = req.body?.assignedToUserId ? String(req.body.assignedToUserId).trim() : undefined;
    const decisionReason = req.body?.decisionReason !== undefined ? String(req.body.decisionReason ?? '').trim() : undefined;
    const message = req.body?.message ? String(req.body.message).trim() : null;
    if (status && !isPqrClaimStatus(status)) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'Estado de reclamo inválido');
      return;
    }
    if (!status && assignedToUserId === undefined && decisionReason === undefined && !message) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'No hay cambios para aplicar');
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextStatus = status ?? claim.status;
      await tx.pqr_claims.update({
        where: { id: claim.id },
        data: {
          ...(status ? { status: status as any } : {}),
          ...(assignedToUserId !== undefined ? { assigned_to_user_id: assignedToUserId || null } : {}),
          ...(decisionReason !== undefined ? { decision_reason: decisionReason || null } : {}),
          ...(['RESOLVED', 'REJECTED', 'CANCELLED'].includes(nextStatus) ? { resolved_at: new Date() } : { resolved_at: null }),
          updated_at: new Date(),
        },
      });
      if (status || message) {
        await tx.pqr_claim_messages.create({
          data: {
            claim_id: claim.id,
            author_id: (req as any).userId,
            message: message || `Estado actualizado a ${nextStatus}`,
            status_from: status ? claim.status as any : null,
            status_to: status ? status as any : null,
          },
        });
      }
      return tx.pqr_claims.findUniqueOrThrow({ where: { id: claim.id }, include: claimIncludes });
    });
    res.json(formatClaim(updated));
  } catch (error: any) {
    console.error('[PQR] Admin update claim error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error actualizando reclamo');
  }
});

// --- CART ENDPOINTS (real) ---

// Helper: get or create ACTIVE cart for user
async function getOrCreateCart(userId: string) {
  let cart = await prisma.carts.findFirst({ where: { user_id: userId, status: 'ACTIVE' } });
  if (!cart) {
    cart = await prisma.carts.create({ data: { user_id: userId, status: 'ACTIVE' } });
  }
  return cart;
}

class SeatReservationConflictError extends Error {
  constructor(message = 'Uno o más asientos ya no están disponibles') {
    super(message);
    this.name = 'SeatReservationConflictError';
  }
}

class CheckoutSeatSaleConflictError extends Error {
  constructor(message = 'La reserva de uno o más asientos expiró o ya no está disponible') {
    super(message);
    this.name = 'CheckoutSeatSaleConflictError';
  }
}

function isSeatHoldAvailabilityDatabaseError(error: any) {
  const message = String(error?.message ?? '');
  return message.includes('is not available for holding');
}

function isCheckoutSeatSaleDatabaseConflict(error: any) {
  const message = `${String(error?.message ?? '')} ${String(error?.meta?.message ?? '')} ${String(error?.meta?.error ?? '')}`;
  return message.includes('division by zero');
}

/** Atomically marks HELD inventory as SOLD; if the number of updated rows != expectedCount, forces division-by-zero so the statement fails and the surrounding transaction rolls back. */
function markHeldSeatInventoryAsSoldOrFail(inventoryIds: string[], expectedCount: number, now: Date) {
  const inventoryIdSql = inventoryIds.map((id) => Prisma.sql`${id}::uuid`);
  return prisma.$executeRaw`
    WITH updated AS (
      UPDATE ticketing.event_seat_inventory
         SET status = 'SOLD'::ticketing.seat_inventory_status,
             updated_at = ${now}
       WHERE id IN (${Prisma.join(inventoryIdSql)})
         AND status = 'HELD'::ticketing.seat_inventory_status
       RETURNING id
    ),
    checked AS (
      SELECT COUNT(*)::int AS sold_count
        FROM updated
    )
    SELECT CASE
             WHEN sold_count = ${expectedCount} THEN 1
             ELSE 1 / (sold_count - sold_count)
           END
      FROM checked
  `;
}

let seatHoldReleaseLastRunAt = 0;
let seatHoldReleaseInFlight: Promise<{ released: number }> | null = null;
const SEAT_HOLD_RELEASE_INTERVAL_MS = 5_000;

async function releaseExpiredSeatHolds(now = new Date()) {
  if (seatHoldReleaseInFlight) {
    return seatHoldReleaseInFlight;
  }

  if (now.getTime() - seatHoldReleaseLastRunAt < SEAT_HOLD_RELEASE_INTERVAL_MS) {
    return { released: 0 };
  }

  seatHoldReleaseLastRunAt = now.getTime();
  seatHoldReleaseInFlight = releaseExpiredSeatHoldsNow(now)
    .finally(() => {
      seatHoldReleaseInFlight = null;
    });

  return seatHoldReleaseInFlight;
}

async function releaseExpiredSeatHoldsNow(now = new Date()) {
  const expiredHolds = await prisma.seat_holds.findMany({
    where: { status: 'ACTIVE', expires_at: { lte: now } },
    select: { id: true, cart_id: true, event_seat_inventory_id: true },
  });

  if (expiredHolds.length === 0) {
    return { released: 0 };
  }

  const holdIds = expiredHolds.map((hold) => hold.id);
  const inventoryIds = Array.from(new Set(expiredHolds.map((hold) => hold.event_seat_inventory_id)));
  const expiredCartItemPairs = expiredHolds.map((hold) => ({
    cart_id: hold.cart_id,
    event_seat_inventory_id: hold.event_seat_inventory_id,
  }));

  await prisma.$transaction([
    prisma.seat_holds.updateMany({
      where: { id: { in: holdIds }, status: 'ACTIVE' },
      data: { status: 'EXPIRED', updated_at: now },
    }),
    prisma.cart_items.deleteMany({
      where: {
        OR: expiredCartItemPairs,
        carts: { is: { status: 'ACTIVE' } },
      },
    }),
    prisma.event_seat_inventory.updateMany({
      where: { id: { in: inventoryIds }, status: 'HELD' },
      data: { status: 'AVAILABLE', updated_at: now },
    }),
  ]);

  return { released: inventoryIds.length };
}

// Helper: transform cart_items rows into the shape the frontend expects
function toCartItemDto(item: any) {
  const tt = item.event_ticket_types ?? item.event_seat_inventory?.event_ticket_types;
  const evt = tt?.events;
  const base = evt ? toEventDto(evt) : undefined;
  const seat = item.event_seat_inventory?.seats;
  return {
    id: item.id,
    quantity: item.quantity,
    seatIds: seat ? [seat.id] : ([] as string[]),
    seatLabels: seat ? [seat.seat_label] : ([] as string[]),
    ticketType: tt ? {
      id: tt.id,
      name: tt.ticket_type_name,
      price: Number(tt.price_amount),
      serviceFee: Number(tt.service_fee_amount),
    } : undefined,
    // venue must be a string for Cart.tsx (toEventDto returns an object)
    event: base ? { ...base, venue: evt.venues?.name ?? '' } : undefined,
  };
}

const cartItemIncludes = {
  event_ticket_types: {
    include: {
      events: { include: eventIncludes },
    },
  },
  event_seat_inventory: {
    include: {
      seats: true,
      event_ticket_types: {
        include: {
          events: { include: eventIncludes },
        },
      },
    },
  },
};

const orderItemIncludes = {
  event_ticket_types: {
    include: {
      events: { include: eventIncludes },
    },
  },
  event_seat_inventory: {
    include: {
      seats: true,
      event_ticket_types: {
        include: {
          events: { include: eventIncludes },
        },
      },
    },
  },
  tickets: true,
};

const orderIncludes = {
  order_items: { include: orderItemIncludes },
};

// GET /api/cart — list items in user's active cart
app.get('/api/cart', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    await releaseExpiredSeatHolds();
    const cart = await prisma.carts.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
      include: { cart_items: { include: cartItemIncludes } },
    });
    res.json((cart?.cart_items ?? []).map(toCartItemDto));
  } catch (error: any) {
    console.error('[CART] GET error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo carrito');
  }
});

// POST /api/cart/items — add item to cart
// Two modes:
//   - General admission: { ticketTypeId, quantity }
//   - Assigned seating: { ticketTypeId, seatIds: [seatUuid, ...] } — one cart_item per seat
app.post('/api/cart/items', authMiddleware, async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) return;
    const userId = (req as any).userId;
    const { ticketTypeId, quantity, seatIds } = req.body;
    await releaseExpiredSeatHolds();
    if (!ticketTypeId) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'ticketTypeId es requerido');
      return;
    }

    const ticketType = await prisma.event_ticket_types.findUnique({ where: { id: ticketTypeId } });
    if (!ticketType) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Tipo de boleta no encontrado');
      return;
    }

    const cart = await getOrCreateCart(userId);
    const hasSeatIds = Array.isArray(seatIds) && seatIds.length > 0;

    if (hasSeatIds) {
      // Assigned seating: one cart_item per seat. The seat_holds trigger marks inventory as HELD.
      if (!ticketType.event_id) {
        sendApiError(req, res, 400, 'BAD_REQUEST', 'Ticket type sin evento');
        return;
      }

      const inventoryRows = await prisma.event_seat_inventory.findMany({
        where: {
          event_id: ticketType.event_id,
          seat_id: { in: seatIds as string[] },
          event_ticket_type_id: ticketTypeId,
        },
      });

      if (inventoryRows.length !== seatIds.length) {
        sendApiError(req, res, 400, 'BAD_REQUEST', 'Uno o más asientos no existen en el inventario del evento');
        return;
      }

      const expiresAt = buildSeatHoldExpiration();
      const reservationOps: any[] = [];

      for (const inv of inventoryRows) {
        if (!isSeatReservable(inv.status)) {
          throw new SeatReservationConflictError();
        }

        reservationOps.push(
          prisma.seat_holds.create({
            data: {
              cart_id: cart.id,
              event_seat_inventory_id: inv.id,
              expires_at: expiresAt,
              status: 'ACTIVE',
            },
          }),
          prisma.cart_items.create({
            data: {
              cart_id: cart.id,
              event_seat_inventory_id: inv.id,
              quantity: 1,
              unit_price_amount: ticketType.price_amount,
              service_fee_amount: ticketType.service_fee_amount,
            },
            include: cartItemIncludes,
          })
        );
      }

      const transactionResults = await prisma.$transaction(reservationOps);
      const createdCartItems = transactionResults.filter((_result, index) => index % 2 === 1);

      // Return the last cart_item created (or all of them — frontend treats them individually)
      const last = createdCartItems[createdCartItems.length - 1];
      res.json(toCartItemDto(last));
      return;
    }

    // General admission flow (unchanged)
    if (!quantity || quantity < 1) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'quantity es requerido para admisión general');
      return;
    }

    const existing = await prisma.cart_items.findFirst({
      where: { cart_id: cart.id, event_ticket_type_id: ticketTypeId, event_seat_inventory_id: null },
    });

    const item = existing
      ? await prisma.cart_items.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + quantity },
          include: cartItemIncludes,
        })
      : await prisma.cart_items.create({
          data: {
            cart_id: cart.id,
            event_ticket_type_id: ticketTypeId,
            quantity,
            unit_price_amount: ticketType.price_amount,
            service_fee_amount: ticketType.service_fee_amount,
          },
          include: cartItemIncludes,
        });

    res.json(toCartItemDto(item));
  } catch (error: any) {
    if (error instanceof SeatReservationConflictError) {
      sendApiError(req, res, 409, 'CONFLICT', error.message);
      return;
    }
    if (isSeatHoldAvailabilityDatabaseError(error)) {
      sendApiError(req, res, 409, 'CONFLICT', 'Uno o más asientos ya no están disponibles');
      return;
    }
    console.error('[CART] POST error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error agregando item al carrito');
  }
});

// PATCH /api/cart/items/:id — update quantity
app.patch('/api/cart/items/:id', authMiddleware, async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) return;
    const userId = (req as any).userId;
    const { quantity } = req.body;
    if (!quantity || quantity < 1) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'quantity debe ser >= 1');
      return;
    }
    const result = await prisma.cart_items.updateMany({
      where: {
        id: req.params.id as string,
        carts: { is: { user_id: userId, status: 'ACTIVE' } },
      },
      data: { quantity },
    });
    if (result.count === 0) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Item de carrito no encontrado');
      return;
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('[CART] PATCH error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error actualizando carrito');
  }
});

// DELETE /api/cart/items/:id — remove single item (releases HELD inventory)
app.delete('/api/cart/items/:id', authMiddleware, async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) return;
    const userId = (req as any).userId;
    const item = await prisma.cart_items.findFirst({
      where: {
        id: req.params.id as string,
        carts: { is: { user_id: userId, status: 'ACTIVE' } },
      },
      select: { id: true, cart_id: true, event_seat_inventory_id: true },
    });
    if (!item) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Item de carrito no encontrado');
      return;
    }

    if (item.event_seat_inventory_id) {
      await prisma.$transaction([
        prisma.seat_holds.updateMany({
          where: {
            cart_id: item.cart_id,
            event_seat_inventory_id: item.event_seat_inventory_id,
            status: 'ACTIVE',
          },
          data: { status: 'RELEASED', updated_at: new Date() },
        }),
        prisma.event_seat_inventory.updateMany({
          where: { id: item.event_seat_inventory_id, status: 'HELD' },
          data: { status: 'AVAILABLE', updated_at: new Date() },
        }),
        prisma.cart_items.delete({ where: { id: item.id } }),
      ]);
    } else {
      await prisma.cart_items.delete({ where: { id: item.id } });
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('[CART] DELETE error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error eliminando item del carrito');
  }
});

// DELETE /api/cart/clear — remove all items from active cart (releases HELD inventory)
app.delete('/api/cart/clear', authMiddleware, async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) return;
    const userId = (req as any).userId;
    const cart = await prisma.carts.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
      include: { cart_items: { select: { id: true, event_seat_inventory_id: true } } },
    });
    if (cart) {
      const heldInventoryIds = cart.cart_items
        .map((i) => i.event_seat_inventory_id)
        .filter((v): v is string => Boolean(v));

      const ops: any[] = [];
      if (heldInventoryIds.length > 0) {
        const now = new Date();
        ops.push(
          prisma.seat_holds.updateMany({
            where: {
              cart_id: cart.id,
              event_seat_inventory_id: { in: heldInventoryIds },
              status: 'ACTIVE',
            },
            data: { status: 'RELEASED', updated_at: now },
          }),
          prisma.event_seat_inventory.updateMany({
            where: { id: { in: heldInventoryIds }, status: 'HELD' },
            data: { status: 'AVAILABLE', updated_at: now },
          })
        );
      }
      ops.push(prisma.cart_items.deleteMany({ where: { cart_id: cart.id } }));
      await prisma.$transaction(ops);
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('[CART] CLEAR error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error limpiando carrito');
  }
});

// --- CHECKOUT ENDPOINTS (simulated payment for thesis demo) ---

// POST /api/checkout/preview — validate cart, return totals
app.post('/api/checkout/preview', authMiddleware, async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) return;
    const userId = (req as any).userId;
    await releaseExpiredSeatHolds();
    const cart = await prisma.carts.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
      include: { cart_items: { include: { event_ticket_types: true } } },
    });
    if (!cart || cart.cart_items.length === 0) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'El carrito está vacío');
      return;
    }

    let subtotal = 0;
    let serviceFees = 0;
    for (const item of cart.cart_items) {
      subtotal += Number(item.unit_price_amount) * item.quantity;
      serviceFees += Number(item.service_fee_amount) * item.quantity;
    }

    res.json({
      subtotal,
      serviceFees,
      total: subtotal + serviceFees,
      itemCount: cart.cart_items.length,
      paymentMode: 'SIMULATED',
      message: 'Pago simulado para demo academica; no se procesa una pasarela fiat real.',
    });
  } catch (error: any) {
    console.error('[CHECKOUT] Preview error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error calculando checkout');
  }
});

// POST /api/checkout/confirm — create order from cart
app.post('/api/checkout/confirm', authMiddleware, async (req, res) => {
  try {
    if (!requireCustomerRole(req, res)) return;
    const userId = (req as any).userId;
    const { buyerEmail, buyerPhone, paymentMethod } = req.body;
    const requestedIdempotencyKey = normalizeIdempotencyKey(req.body?.idempotencyKey ?? req.headers['idempotency-key']);
    await releaseExpiredSeatHolds();

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) { sendApiError(req, res, 404, 'NOT_FOUND', 'Usuario no encontrado'); return; }

    if (requestedIdempotencyKey) {
      const orderNumber = buildSimulatedOrderNumber(requestedIdempotencyKey);
      const existingOrder = await prisma.orders.findFirst({
        where: { user_id: userId, order_number: orderNumber },
        include: orderIncludes,
      });
      if (existingOrder) {
        res.json(formatCheckoutOrderResponse(existingOrder, true));
        return;
      }
    }

    const cart = await prisma.carts.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
      include: { cart_items: { include: { event_ticket_types: true } } },
    });
    if (!cart || cart.cart_items.length === 0) {
      sendApiError(req, res, 400, 'BAD_REQUEST', 'El carrito está vacío');
      return;
    }

    // Calculate totals
    let subtotal = 0;
    let serviceFees = 0;
    for (const item of cart.cart_items) {
      subtotal += Number(item.unit_price_amount) * item.quantity;
      serviceFees += Number(item.service_fee_amount) * item.quantity;
    }
    const total = subtotal + serviceFees;

    const now = new Date();
    const effectiveIdempotencyKey = requestedIdempotencyKey ?? `checkout:${userId}:${cart.id}`;
    const orderNumber = buildSimulatedOrderNumber(effectiveIdempotencyKey);
    const ticketCodePart = orderNumber.slice(-5);

    const orderItemCreates = cart.cart_items.map((cartItem) => ({
      event_ticket_type_id: cartItem.event_ticket_type_id,
      event_seat_inventory_id: cartItem.event_seat_inventory_id,
      quantity: cartItem.quantity,
      unit_price_amount: cartItem.unit_price_amount,
      service_fee_amount: cartItem.service_fee_amount,
      tickets: {
        create: Array.from({ length: cartItem.quantity }, (_, i) => ({
          owner_user_id: userId,
          ticket_code: `TK-${ticketCodePart}-${cartItem.id.slice(-4).toUpperCase()}-${i + 1}`,
          status: 'ACTIVE' as const,
        })),
      },
    }));

    const seatInventoryIdsToSell = Array.from(new Set(cart.cart_items
      .map((i) => i.event_seat_inventory_id)
      .filter((v): v is string => Boolean(v))));

    if (seatInventoryIdsToSell.length > 0) {
      const [activeHolds, heldSeats] = await Promise.all([
        prisma.seat_holds.count({
          where: {
            cart_id: cart.id,
            event_seat_inventory_id: { in: seatInventoryIdsToSell },
            status: 'ACTIVE',
            expires_at: { gt: now },
          },
        }),
        prisma.event_seat_inventory.count({
          where: { id: { in: seatInventoryIdsToSell }, status: 'HELD' },
        }),
      ]);

      if (activeHolds !== seatInventoryIdsToSell.length || heldSeats !== seatInventoryIdsToSell.length) {
        sendApiError(req, res, 409, 'CONFLICT', 'La reserva de uno o más asientos expiró o ya no está disponible');
        return;
      }
    }

    let order;
    if (seatInventoryIdsToSell.length > 0) {
      const [, , createdOrder] = await prisma.$transaction([
        markHeldSeatInventoryAsSoldOrFail(seatInventoryIdsToSell, seatInventoryIdsToSell.length, now),
        prisma.seat_holds.updateMany({
          where: {
            cart_id: cart.id,
            event_seat_inventory_id: { in: seatInventoryIdsToSell },
            status: 'ACTIVE',
          },
          data: { status: 'CONSUMED', updated_at: now },
        }),
        prisma.orders.create({
          data: {
            user_id: userId,
            order_number: orderNumber,
            status: 'PAID',
            subtotal_amount: subtotal,
            service_fee_amount: serviceFees,
            total_amount: total,
            buyer_email: buyerEmail || user.email,
            buyer_phone: buyerPhone || user.phone,
            buyer_document_type: user.document_type,
            buyer_document_number: user.document_number,
            order_items: { create: orderItemCreates },
            payments: {
              create: {
                payment_method: paymentMethod || 'CARD',
                status: 'PAID',
                amount: total,
                provider_reference: `SIMULATED:${effectiveIdempotencyKey}`,
                processed_at: now,
              },
            },
          },
        }),
        prisma.carts.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } }),
      ]);
      order = createdOrder;
    } else {
      // General admission keeps the batch transaction path; no seat inventory
      // count must be checked here.
      const [createdOrder] = await prisma.$transaction([
        prisma.orders.create({
          data: {
            user_id: userId,
            order_number: orderNumber,
            status: 'PAID',
            subtotal_amount: subtotal,
            service_fee_amount: serviceFees,
            total_amount: total,
            buyer_email: buyerEmail || user.email,
            buyer_phone: buyerPhone || user.phone,
            buyer_document_type: user.document_type,
            buyer_document_number: user.document_number,
            order_items: { create: orderItemCreates },
            payments: {
              create: {
                payment_method: paymentMethod || 'CARD',
                status: 'PAID',
                amount: total,
                provider_reference: `SIMULATED:${effectiveIdempotencyKey}`,
                processed_at: now,
              },
            },
          },
        }),
        prisma.carts.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } }),
      ]);
      order = createdOrder;
    }

    const fullOrder = await prisma.orders.findUnique({
      where: { id: order.id },
      include: orderIncludes,
    });

    res.json(formatCheckoutOrderResponse(fullOrder ?? order, false));
  } catch (error: any) {
    if (error instanceof CheckoutSeatSaleConflictError || isCheckoutSeatSaleDatabaseConflict(error)) {
      sendApiError(req, res, 409, 'CONFLICT', 'La reserva de uno o más asientos expiró o ya no está disponible');
      return;
    }
    if (error?.code === 'P2002') {
      const userId = (req as any).userId;
      const requestedIdempotencyKey = normalizeIdempotencyKey(req.body?.idempotencyKey ?? req.headers['idempotency-key']);
      if (requestedIdempotencyKey) {
        const existingOrder = await prisma.orders.findFirst({
          where: { user_id: userId, order_number: buildSimulatedOrderNumber(requestedIdempotencyKey) },
          include: orderIncludes,
        });
        if (existingOrder) {
          res.json(formatCheckoutOrderResponse(existingOrder, true));
          return;
        }
      }
    }
    console.error('[CHECKOUT] Confirm error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error confirmando checkout');
  }
});

function formatCheckoutOrderResponse(order: {
  id: string;
  order_number: string;
  buyer_email?: unknown;
  buyer_phone?: string | null;
  buyer_document_type?: unknown;
  buyer_document_number?: string | null;
  subtotal_amount: unknown;
  service_fee_amount: unknown;
  total_amount: unknown;
  created_at?: Date;
  status?: string;
  order_items?: any[];
}, idempotentReplay: boolean) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    buyerEmail: order.buyer_email ? String(order.buyer_email) : '',
    buyerPhone: order.buyer_phone ?? '',
    buyerDocument: order.buyer_document_type && order.buyer_document_number
      ? `${String(order.buyer_document_type)} ${order.buyer_document_number}`
      : '',
    subtotal: Number(order.subtotal_amount),
    serviceFees: Number(order.service_fee_amount),
    total: Number(order.total_amount),
    createdAt: order.created_at?.toISOString?.() ?? new Date().toISOString(),
    status: order.status === 'PENDING_PAYMENT' ? 'pending' : 'confirmed',
    items: (order.order_items ?? []).flatMap((item: any) => toOrderItemTicketDtos(item)),
    paymentMode: 'SIMULATED',
    paymentStatus: 'SIMULATED_PAID',
    idempotentReplay,
    message: 'Pago simulado para demo academica; no se proceso una pasarela fiat real.',
  };
}

function toOrderItemTicketDtos(item: any) {
  const tt = item.event_ticket_types ?? item.event_seat_inventory?.event_ticket_types;
  const evt = tt?.events;
  const seat = item.event_seat_inventory?.seats;
  const tickets = item.tickets?.length ? item.tickets : Array.from({ length: item.quantity }, (_unused, index) => ({ id: `${item.id}-${index}` }));

  return tickets.map((ticket: any) => ({
    id: ticket.id,
    ticketCode: ticket.ticket_code,
    purchasedAt: ticket.issued_at?.toISOString?.() ?? item.created_at?.toISOString?.() ?? new Date().toISOString(),
    quantity: 1,
    seatIds: seat ? [seat.id] : [],
    ticketType: tt ? {
      id: tt.id,
      name: tt.ticket_type_name,
      price: Number(tt.price_amount),
      serviceFee: Number(tt.service_fee_amount),
    } : undefined,
    event: evt ? toEventDto(evt) : undefined,
  }));
}

// --- ORDERS & TICKETS ENDPOINTS (real) ---

// GET /api/orders — user's order history
app.get('/api/orders', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const orders = await prisma.orders.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    res.json(orders.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      createdAt: o.created_at.toISOString(),
      total: Number(o.total_amount),
      subtotal: Number(o.subtotal_amount),
      serviceFees: Number(o.service_fee_amount),
      status: o.status === 'PAID' ? 'confirmed' : 'pending',
    })));
  } catch (error: any) {
    console.error('[ORDERS] GET error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo ordenes');
  }
});

// GET /api/orders/:id — full order detail for confirmation refresh
app.get('/api/orders/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const order = await prisma.orders.findFirst({
      where: { id: String(req.params.id), user_id: userId },
      include: orderIncludes,
    });
    if (!order) {
      sendApiError(req, res, 404, 'NOT_FOUND', 'Orden no encontrada');
      return;
    }

    res.json(formatCheckoutOrderResponse(order, false));
  } catch (error: any) {
    console.error('[ORDERS] GET detail error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo orden');
  }
});

// GET /api/tickets — user's tickets
app.get('/api/tickets', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const tickets = await prisma.tickets.findMany({
      where: { owner_user_id: userId, status: 'ACTIVE' },
      include: {
        order_items: {
          include: {
            event_ticket_types: {
              include: { events: { include: eventIncludes } },
            },
            event_seat_inventory: {
              include: {
                seats: { include: { venue_sections: true } },
                event_ticket_types: {
                  include: { events: { include: eventIncludes } },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const contractAddressesWithoutOrderEvent = [
      ...new Set(
        tickets
          .filter((t) => {
            const tt = t.order_items?.event_ticket_types ?? t.order_items?.event_seat_inventory?.event_ticket_types;
            return !tt?.events && Boolean(t.contract_address);
          })
          .map((t) => t.contract_address!)
      ),
    ];
    const fallbackEvents = contractAddressesWithoutOrderEvent.length
      ? await prisma.events.findMany({
          where: { contract_address: { in: contractAddressesWithoutOrderEvent } },
          include: eventIncludes,
        })
      : [];
    const eventByContract = new Map(fallbackEvents.map((event) => [event.contract_address, event]));

    const p2pLookups = await Promise.all(
      tickets.map(async (t) => {
        if (
          typeof t.version === 'number' &&
          t.version > 0 &&
          t.contract_address &&
          t.ticket_root_id != null
        ) {
          const prev = await prisma.tickets.findFirst({
            where: {
              contract_address: t.contract_address,
              ticket_root_id: t.ticket_root_id,
              version: t.version - 1,
            },
            select: { resale_price: true },
          });
          return prev?.resale_price ? Number(prev.resale_price) : null;
        }
        return null;
      })
    );

    res.json(tickets.map((t, idx) => {
      const tt = t.order_items?.event_ticket_types ?? t.order_items?.event_seat_inventory?.event_ticket_types;
      const evt = tt?.events ?? (t.contract_address ? eventByContract.get(t.contract_address) : undefined);
      const seat = t.order_items?.event_seat_inventory?.seats;
      const acquiredViaResale = typeof t.version === 'number' && t.version > 0;
      const signedQrPayload = t.contract_address && t.ticket_root_id != null && t.version != null && evt?.id
        ? JSON.stringify(buildSignedTicketQrPayload({
            contractAddress: t.contract_address,
            ticketRootId: t.ticket_root_id,
            version: t.version,
            eventId: evt.id,
            ownerWallet: t.owner_wallet ?? null,
          }))
        : t.qr_payload;
      return {
        id: t.id,
        ticketCode: t.ticket_code,
        purchasedAt: t.issued_at.toISOString(),
        quantity: 1,
        ticketType: tt ? {
          id: tt.id,
          name: tt.ticket_type_name,
          price: Number(tt.price_amount),
          serviceFee: Number(tt.service_fee_amount),
        } : undefined,
        event: evt ? toEventDto(evt) : undefined,
        seatLabel: seat?.seat_label ?? null,
        sectionName: seat?.venue_sections?.section_name ?? null,
        // Web3 fields
        isSecuredOnChain: Boolean(t.contract_address),
        isForSale: t.is_for_sale ?? false,
        contractAddress: t.contract_address,
        ticketRootId: t.ticket_root_id,
        version: t.version,
        ownerWallet: t.owner_wallet,
        resalePrice: acquiredViaResale
          ? p2pLookups[idx]
          : t.resale_price ? Number(t.resale_price) : null,
        acquiredViaResale,
        nftContractAddress: (evt as any)?.nft_contract_address ?? null,
        nftTokenId: (t as any).nft_token_id ?? null,
        qrPayload: signedQrPayload,
      };
    }));
  } catch (error: any) {
    console.error('[TICKETS] GET error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo tickets');
  }
});

// GET /api/tickets/sold — tickets the user sold via resale
app.get('/api/tickets/sold', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    // Sold tickets are previous versions explicitly replaced by a resale flow.
    const tickets = await prisma.tickets.findMany({
      where: {
        owner_user_id: userId,
        status: 'CANCELLED',
        lifecycle_reason: { in: ['RESOLD_PREVIOUS_VERSION', 'PRIMARY_P2P_REPLACED'] },
      },
      include: {
        order_items: {
          include: {
            event_ticket_types: {
              include: { events: { include: eventIncludes } },
            },
            event_seat_inventory: {
              include: {
                event_ticket_types: {
                  include: { events: { include: eventIncludes } },
                },
              },
            },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    // For each sold ticket, find the buyer (next version of same ticket_root_id)
    const results = await Promise.all(tickets.map(async (t) => {
      const tt = t.order_items?.event_ticket_types ?? t.order_items?.event_seat_inventory?.event_ticket_types;
      const evt = tt?.events;

      // The buyer is the owner of the next version
      let buyerWallet: string | null = null;
      if (t.contract_address && t.ticket_root_id != null && t.version != null) {
        const nextVersion = await prisma.tickets.findFirst({
          where: {
            contract_address: t.contract_address,
            ticket_root_id: t.ticket_root_id,
            version: t.version + 1,
          },
          select: { owner_wallet: true },
        });
        buyerWallet = nextVersion?.owner_wallet ?? null;
      }

      return {
        id: t.id,
        ticketCode: t.ticket_code,
        soldAt: t.updated_at.toISOString(),
        resalePrice: Number(t.resale_price),
        contractAddress: t.contract_address,
        ticketRootId: t.ticket_root_id,
        version: t.version,
        buyerWallet,
        ticketType: tt ? {
          id: tt.id,
          name: tt.ticket_type_name,
          price: Number(tt.price_amount),
        } : undefined,
        event: evt ? toEventDto(evt) : undefined,
      };
    }));
    res.json(results);
  } catch (error: any) {
    console.error('[TICKETS/SOLD] GET error:', error);
    sendApiError(req, res, 500, 'INTERNAL_ERROR', 'Error obteniendo ventas P2P');
  }
});

const isServerless = Boolean(process.env.VERCEL);
const shouldRunIndexer =
  process.env.RUN_INDEXER === 'true' ||
  (process.env.RUN_INDEXER !== 'false' && isProduction);

// START THE SERVER (local/self-hosted mode)
if (!isServerless) {
  app.listen(PORT, () => {
    console.log(`[HTTP] Express server listening on http://localhost:${PORT}`);

    // The indexer competes for DB pool connections; enable it explicitly in local dev.
    if (shouldRunIndexer) {
      runIndexer().catch(err => console.error('[INDEXER] Fatal Error:', err));
    } else {
      console.log('[INDEXER] Disabled. Set RUN_INDEXER=true to enable it.');
    }
  });
}

export default app;

export async function closeAppResources() {
  await prisma.$disconnect();
}
