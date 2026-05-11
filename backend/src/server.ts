import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
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
import { buildSimulatedOrderNumber, normalizeIdempotencyKey } from './checkoutPolicy';
import { deriveChainEventId } from './secureTicketPolicy';
import { createWalletChallenge, verifyWalletChallengeSignature } from './walletChallengePolicy';
import { signTicketQr } from './qrPolicy';
import { authorizeTransactionIntentCurrentState, authorizeTransactionIntentSubmit, buildTransactionIntentExpiry } from './transactionIntentPolicy';
import { authorizeSingleEventDeploy } from './deployEventPolicy';
import { codeForStatus, requestIdMiddleware, sendApiError } from './apiError';
import { evaluateRateLimit, isCorsOriginAllowed, isJwtSecretStrong, parseCorsOrigins, type RateLimitBucket } from './securityPolicy';
import { buildSeatHoldExpiration, evaluateAtomicSeatReservation, evaluateAtomicSeatSale } from './seatHoldPolicy';
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
  const accResp = await sorobanServer.getAccount(signer.publicKey());
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
  if (res.status !== 'SUCCESS') throw new Error(`Soroban tx failed: ${res.status}`);
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
    res.status(401).json({ error: 'Token requerido' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), EFFECTIVE_JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    const user = await prisma.users.findUnique({
      where: { id: payload.userId },
      select: { is_active: true },
    });
    if (user && !user.is_active) {
      sendApiError(req, res, 403, 'USER_INACTIVE', 'Usuario inactivo');
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
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
app.use(express.json());

// ── In-memory cache (avoids repeated Supabase round-trips ~150ms each) ──
const cache = new Map<string, { data: any; expires: number }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return Promise.resolve(hit.data as T);
  return fn().then((data) => { cache.set(key, { data, expires: Date.now() + ttlMs }); return data; });
}
function invalidateCache(prefix?: string) {
  if (!prefix) { cache.clear(); return; }
  for (const key of cache.keys()) { if (key.startsWith(prefix)) cache.delete(key); }
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
}): { qrToken: string } {
  return {
    qrToken: signTicketQr({
      secret: QR_SIGNING_SECRET,
      contractAddress: input.contractAddress,
      ticketRootId: input.ticketRootId,
      version: input.version,
      eventId: input.eventId,
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

// GET /api/tickets/qr/:assetCode.png — public PNG referenced by stellar.toml.
// QR encodes { contractAddress, ticketRootId } so the door scanner can resolve
// the live ticket version regardless of resale history.
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
        contract_address: ticket.contract_address,
        ticket_root_id: (ticket as any).ticket_root_id,
        status: 'ACTIVE',
      },
      orderBy: { version: 'desc' },
      select: { version: true } as any,
    });
    const version = (live as any)?.version ?? 1;
    const cacheKey = `${assetCode}:v${version}`;

    if (!qrCache.has(cacheKey)) {
      const buf = await buildTicketQrPng(buildSignedTicketQrPayload({
        contractAddress: ticket.contract_address,
        ticketRootId: (ticket as any).ticket_root_id,
        version,
        eventId,
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
    posterImage: images?.poster ?? fallback,
    bannerImage: images?.banner ?? fallback,
  };
}

const eventIncludes = {
  venues: { include: { cities: true } },
  organizers: true,
  event_categories: true,
  event_ticket_types: { where: { is_active: true } },
};

// GET /api/events - List published events
app.get('/api/events', async (req, res) => {
  try {
    const events = await cached('events:all', 60_000, () =>
      prisma.events.findMany({ where: { status: 'PUBLISHED' }, include: eventIncludes, orderBy: { starts_at: 'asc' } })
    );
    res.json(events.map(toEventDto));
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }

    // Live tickets are NOT cached (change frequently with resale)
    let live_tickets: any[] = [];
    if (event.contract_address) {
       const rawTickets = await prisma.tickets.findMany({
         where: { contract_address: event.contract_address, is_for_sale: true, status: 'ACTIVE' },
         select: {
           id: true, ticket_root_id: true, version: true, owner_wallet: true, contract_address: true, resale_price: true, asset_code: true,
           nft_token_id: true,
         } as any,
       }) as any[];
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
    const ticketTypes = (event.event_ticket_types ?? []).map((t: any) => ({
      id: t.id,
      name: t.ticket_type_name,
      price: Number(t.price_amount),
      serviceFee: Number(t.service_fee_amount),
      availability: t.inventory_quantity ?? 0,
      maxPerOrder: t.max_per_order ?? 10,
    }));

    res.json({
      ...toEventDto(event),
      live_tickets,
      contractAddress: event.contract_address,
      nftContractAddress: (event as any).nft_contract_address ?? null,
      ticketTypes,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:id/ticket-types - Ticket types for an event
app.get('/api/events/:id/ticket-types', async (req, res) => {
  try {
    const types = await prisma.event_ticket_types.findMany({
      where: { event_id: req.params.id, is_active: true },
    });
    res.json(types);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
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
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }

    if (!event.has_assigned_seating) {
      res.status(400).json({ error: 'Este evento no tiene selección de asientos' });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
      res.status(404).json({ error: 'Evento no válido o sin contrato asignado' });
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
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transactions/secure-ticket — Register ticket on Soroban blockchain
// The organizer issues the ticket on-chain directly to the user's linked wallet.
app.post('/api/transactions/secure-ticket', authMiddleware, async (req, res) => {
  try {
    if (!organizerKeypair) {
      res.status(503).json({ error: 'Blockchain no configurada (falta ORGANIZER_SECRET)' });
      return;
    }

    const { ticketId } = req.body;
    if (!ticketId) {
      res.status(400).json({ error: 'ticketId es requerido' });
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
      res.status(404).json({ error: 'Ticket no encontrado' });
      return;
    }
    if (ticket.owner_user_id !== (req as any).userId) {
      res.status(403).json({ error: 'No autorizado' });
      return;
    }
    if (ticket.contract_address) {
      res.status(409).json({ error: 'Ticket ya asegurado en blockchain', txHash: ticket.contract_address });
      return;
    }

    const ownerUser = await prisma.users.findUnique({
      where: { id: (req as any).userId },
      select: { wallet_address: true },
    });
    if (!ownerUser?.wallet_address) {
      res.status(400).json({ error: 'Debes vincular una wallet antes de asegurar el ticket en blockchain' });
      return;
    }

    const ticketType = ticket.order_items?.event_ticket_types ?? ticket.order_items?.event_seat_inventory?.event_ticket_types;
    const event = ticketType?.events;
    if (!event?.contract_address) {
      res.status(400).json({ error: 'Evento sin contrato desplegado' });
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
      res.status(400).json({ error: 'El usuario no tiene wallet vinculada. Vincula tu wallet primero.' });
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
      res.status(500).json({ error: 'Error en simulación blockchain' });
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
      res.status(500).json({ error: 'Error enviando transacción a la red' });
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

      res.status(500).json({
        error: 'Transacción blockchain fallida',
        detail: getResponse.status,
        diagnostics: diagnosticSummary,
        metaXdr: metaB64,
      });
      return;
    }

    // Extract ticket_root_id from return value
    const returnValue = (getResponse as any).returnValue;
    let ticketRootId = 0;
    if (returnValue) {
      try {
        // Result<u32, ErrorContrato> — unwrap the Ok variant
        const val = returnValue.value?.();
        ticketRootId = typeof val === 'number' ? val : Number(val);
      } catch {
        console.warn('[SOROBAN] Could not parse return value, using 0');
      }
    }

    // Mint el NFT en el ticket_nft_contract del evento (Phase 4.5).
    // El organizer es admin del NFT contract, así que firma el mint server-side.
    // token_id = ticket_root_id (1 NFT por raíz; sobrevive a reventas).
    const nftContractAddress = (event as any).nft_contract_address as string | null;
    let nftMintTxHash: string | null = null;
    let nftTokenId: number | null = null;
    if (nftContractAddress) {
      try {
        const tokenUri = `${PUBLIC_BASE_URL}/api/nft/metadata/${nftContractAddress}/${ticketRootId}`;
        const mintRes = await invokeSoroban(
          organizerKeypair,
          nftContractAddress,
          'mint',
          [
            new Address(buyerWallet).toScVal(),
            nativeToScVal(ticketRootId, { type: 'u32' }),
            nativeToScVal(tokenUri, { type: 'string' }),
          ],
        );
        nftMintTxHash = (mintRes as any).txHash ?? null;
        nftTokenId = ticketRootId;
        console.log(`[NFT] Minted token_id=${ticketRootId} on ${nftContractAddress.slice(0,8)}… to ${buyerWallet.slice(0,8)}…`);
      } catch (mintErr: any) {
        console.warn('[NFT] mint failed (graceful degradation, ticket still secured):', mintErr?.message);
      }
    } else {
      console.warn(`[NFT] event ${event.id} has no nft_contract_address — skipping NFT mint`);
    }

    // Update DB with on-chain data (idempotent)
    await prisma.tickets.update({
      where: { id: ticketId },
      data: {
        contract_address: contractAddress,
        ticket_root_id: ticketRootId,
        version: 0,
        owner_wallet: ownerUser.wallet_address,
        ...(nftTokenId != null ? ({ nft_token_id: nftTokenId } as any) : {}),
      },
    });

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
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transactions/mint-collectible — DEPRECATED (Phase 4.5)
// El mint del NFT ahora ocurre dentro de /secure-ticket via el contrato Soroban
// ticket_nft_contract. Endpoint conservado como no-op idempotente para clientes
// antiguos.
app.post('/api/transactions/mint-collectible', authMiddleware, async (_req, res) => {
  res.json({ success: true, deprecated: true, message: 'Mint NFT ahora se hace en /secure-ticket' });
});

// POST /api/transactions/list-ticket — Build owner-signed XDR to list a ticket for resale on Soroban
app.post('/api/transactions/list-ticket', authMiddleware, async (req, res) => {
  try {
    const { ticketId, price } = req.body; // price in XLM stroops (1 XLM = 10_000_000)
    if (!ticketId || !price || price <= 0) {
      res.status(400).json({ error: 'ticketId y price son requeridos' });
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: (req as any).userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      res.status(400).json({ error: 'Debes vincular una wallet antes de listar un ticket' });
      return;
    }

    const ticket = await prisma.tickets.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
    if (ticket.owner_user_id !== (req as any).userId) { res.status(403).json({ error: 'No autorizado' }); return; }
    if (!ticket.contract_address || ticket.ticket_root_id === null) { res.status(400).json({ error: 'Ticket no registrado en blockchain' }); return; }
    if (ticket.is_for_sale) { res.status(409).json({ error: 'Ticket ya está en venta' }); return; }
    if (!ticket.owner_wallet || ticket.owner_wallet !== user.wallet_address) {
      res.status(403).json({ error: 'La wallet vinculada no coincide con el propietario on-chain registrado' });
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
      res.status(400).json({ error: 'No fue posible preparar la firma de reventa: ' + simError });
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
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transactions/cancel-listing — Build owner-signed XDR to cancel a resale listing on Soroban
app.post('/api/transactions/cancel-listing', authMiddleware, async (req, res) => {
  try {
    const { ticketId } = req.body;
    if (!ticketId) {
      res.status(400).json({ error: 'ticketId es requerido' });
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: (req as any).userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      res.status(400).json({ error: 'Debes vincular una wallet antes de cancelar una reventa' });
      return;
    }

    const ticket = await prisma.tickets.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
    if (ticket.owner_user_id !== (req as any).userId) { res.status(403).json({ error: 'No autorizado' }); return; }
    if (!ticket.contract_address || ticket.ticket_root_id === null) { res.status(400).json({ error: 'Ticket no registrado en blockchain' }); return; }
    if (!ticket.is_for_sale) { res.status(409).json({ error: 'Ticket no está en venta' }); return; }
    if (!ticket.owner_wallet || ticket.owner_wallet !== user.wallet_address) {
      res.status(403).json({ error: 'La wallet vinculada no coincide con el propietario on-chain registrado' });
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
      res.status(400).json({ error: 'No fue posible preparar la firma de cancelación: ' + simError });
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
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transactions/build-buy-xdr — Build unsigned XDR for comprar_boleto (Freighter signs)
app.post('/api/transactions/build-buy-xdr', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { contractAddress, ticketRootId, buyerPublicKey } = req.body;
    if (!contractAddress || ticketRootId === undefined || !buyerPublicKey) {
      res.status(400).json({ error: 'contractAddress, ticketRootId y buyerPublicKey son requeridos' });
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      res.status(400).json({ error: 'Debes vincular una wallet antes de construir una transacción' });
      return;
    }
    if (buyerPublicKey !== user.wallet_address) {
      res.status(403).json({ error: 'buyerPublicKey no coincide con la wallet vinculada al usuario' });
      return;
    }

    // Verify ticket is listed
    const ticket = await prisma.tickets.findFirst({
      where: { contract_address: contractAddress, ticket_root_id: ticketRootId, is_for_sale: true, status: 'ACTIVE' },
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket no está en venta' });
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
        res.status(400).json({ error: 'Saldo insuficiente en tu billetera Stellar. Necesitas más XLM para completar la compra. Puedes obtener XLM de prueba en friendbot.stellar.org' });
        return;
      }
      if (simError.includes('#8')) {
        res.status(400).json({ error: 'No puedes comprar tu propio boleto' });
        return;
      }
      res.status(500).json({ error: 'Error en simulación: ' + simError });
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
    res.status(500).json({ error: error.message });
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
      const result = await invokeSoroban(
        organizerKeypair,
        authorization.nftContractAddress,
        'admin_transfer',
        [
          nativeToScVal(Number(ticketRootId), { type: 'u32' }),
          new Address(String(buyerWallet)).toScVal(),
        ],
      );
      console.log(`[NFT] verified admin_transfer token=${ticketRootId} v${authorization.version} -> ${String(buyerWallet).slice(0,8)}...`);
      res.json({ success: true, txHash: (result as any).txHash ?? null });
    } catch (e: any) {
      // Mensaje TransferenciaInvalida (=6) cuando from==to → idempotente
      const msg = String(e?.message ?? '');
      if (msg.includes('TransferenciaInvalida') || msg.includes('#6')) {
        res.json({ success: true, alreadyTransferred: true });
        return;
      }
      throw e;
    }
  } catch (error: any) {
    console.error('[NFT] transfer error:', error?.message ?? error);
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
    const event = await prisma.events.findFirst({
      where: { nft_contract_address: nftContractAddress } as any,
      select: { title: true, starts_at: true, contract_address: true, slug: true } as any,
    });
    if (!event) {
      res.status(404).json({ error: 'NFT contract no encontrado' });
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
    res.status(500).json({ error: 'Error generando metadata' });
  }
});

// GET /api/nft/qr/:contractAddress/:tokenId.png — PNG con el QR codificando
// {contractAddress (event_contract), ticketRootId} para validación en puerta.
// Es la imagen que el JSON de metadata referencia.
app.get('/api/nft/qr/:nftContractAddress/:tokenIdRaw', async (req, res) => {
  try {
    const { nftContractAddress, tokenIdRaw } = req.params;
    const tokenId = Number(tokenIdRaw.replace(/\.png$/i, ''));
    if (!Number.isFinite(tokenId) || tokenId < 0) {
      res.status(400).type('text/plain').send('Invalid tokenId');
      return;
    }
    const event = await prisma.events.findFirst({
      where: { nft_contract_address: nftContractAddress } as any,
      select: { id: true, contract_address: true } as any,
    });
    const eventContract = (event as any)?.contract_address as string | null | undefined;
    if (!eventContract) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const live = await prisma.tickets.findFirst({
      where: {
        contract_address: eventContract,
        ticket_root_id: tokenId,
        status: 'ACTIVE',
      },
      orderBy: { version: 'desc' },
      select: { version: true } as any,
    });
    const version = (live as any)?.version ?? 1;
    const cacheKey = `nft:${nftContractAddress}:${tokenId}:v${version}`;
    if (!qrCache.has(cacheKey)) {
      const buf = await buildTicketQrPng(buildSignedTicketQrPayload({
        contractAddress: eventContract,
        ticketRootId: tokenId,
        version,
        eventId: (event as any).id,
      }));
      qrCache.set(cacheKey, buf);
    }
    res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    res.setHeader('Content-Type', 'image/png');
    res.send(qrCache.get(cacheKey)!);
  } catch (err: any) {
    console.error('[NFT qr] error:', err?.message);
    res.status(500).type('text/plain').send('Error generating QR');
  }
});

// POST /api/transactions/submit-classic — Submit a Freighter-signed CLASSIC tx
// (e.g. CHANGE_TRUST for the collectible) to Horizon, not Soroban RPC.
app.post('/api/transactions/submit-classic', transactionRateLimit, authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { signedXdr } = req.body;
    if (!signedXdr) { res.status(400).json({ error: 'signedXdr es requerido' }); return; }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      res.status(400).json({ error: 'Debes vincular una wallet antes de enviar una transacción' });
      return;
    }

    const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    if (tx instanceof FeeBumpTransaction) {
      res.status(400).json({ error: 'Fee-bump no soportado' }); return;
    }
    if (tx.source !== user.wallet_address) {
      res.status(403).json({ error: 'La transacción no corresponde a tu wallet' });
      return;
    }

    const result = await horizonServer.submitTransaction(tx);
    res.json({ success: true, txHash: (result as any).hash });
  } catch (error: any) {
    const data = error?.response?.data;
    console.error('[CLASSIC] submit error:', data ?? error?.message);
    res.status(500).json({ error: error.message ?? 'Error enviando transacción clásica', detail: data });
  }
});

// --- ADMIN ENDPOINTS (Restringido) ---
app.get('/api/admin/venues', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { res.status(403).json({ error: 'Acceso denegado' }); return; }

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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// POST /api/admin/scan — Redeem a ticket
app.post('/api/admin/scan', scannerRateLimit, authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    const roleDecision = authorizeScannerRole(user?.role);
    if (roleDecision) {
      sendApiError(req, res, roleDecision.status, codeForStatus(roleDecision.status), roleDecision.error);
      return;
    }

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
    } else {
      requestedVersion = scanRequest.version;
      const event = await prisma.events.findFirst({
        where: {
          id: scanRequest.eventId,
          contract_address: scanRequest.contractAddress,
        } as any,
        select: { id: true } as any,
      });
      if (!event) {
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
      ticket ? { id: ticket.id, status: ticket.status, version: (ticket as any).version ?? null } : null,
      requestedVersion,
    );
    if (!scanDecision.ok) {
      sendApiError(req, res, scanDecision.status, codeForStatus(scanDecision.status), scanDecision.error);
      return;
    }

    // Gate scan is DB-only for thesis demo speed. Soroban redemption is handled
    // only when the indexer receives a boleto_redimido event from an on-chain flow.
    await prisma.tickets.update({
       where: { id: scanDecision.ticketId },
       data: { status: 'USED', used_at: new Date(), is_for_sale: false }
    });

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
    if (!user || user.role !== 'ADMIN') { res.status(403).json({ error: 'Acceso denegado' }); return; }

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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get('/api/admin/events', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { res.status(403).json({ error: 'Acceso denegado' }); return; }

    const events = await prisma.events.findMany({
      include: eventIncludes,
      orderBy: { created_at: 'desc' }
    });
    res.json(events.map(toEventDto));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/events', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (user?.role !== 'ADMIN') { res.status(403).json({ error: 'Acceso denegado' }); return; }

    const { title, slug, category_id, date, venue_id, sections } = req.body;
    
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
      }
    });

    if (sections && Array.isArray(sections)) {
      for (const s of sections) {
        await prisma.event_ticket_types.create({
          data: {
            event_id: newEvent.id,
            venue_section_id: s.id,
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
    res.status(500).json({ error: error.message });
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
      res.status(400).json({ error: 'Email y contraseña son requeridos' });
      return;
    }

    const user = await prisma.users.findFirst({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    // Update last login
    await prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } });

    const accessToken = jwt.sign({ userId: user.id }, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ accessToken, user: toUserDto(user) });
  } catch (error: any) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    const { firstName, lastName, email, password, documentType, documentNumber, phone } = req.body;
    if (!firstName || !email || !password || !documentNumber) {
      res.status(400).json({ error: 'Campos requeridos: firstName, email, password, documentNumber' });
      return;
    }

    // Check if email already exists
    const existing = await prisma.users.findFirst({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Ya existe una cuenta con ese correo electrónico' });
      return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.create({
      data: {
        first_name: firstName,
        last_name: lastName || '',
        email,
        password_hash,
        document_type: documentType || 'CC',
        document_number: documentNumber,
        phone: phone || null,
      },
    });

    const accessToken = jwt.sign({ userId: user.id }, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ accessToken, user: toUserDto(user) });
  } catch (error: any) {
    console.error('[AUTH] Register error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/users/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    res.json(toUserDto(user));
  } catch (error: any) {
    console.error('[AUTH] Me error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
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
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/wallet/challenge — issue a short-lived message to prove wallet ownership
app.post('/api/wallet/challenge', walletRateLimit, authMiddleware, async (req, res) => {
  try {
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

async function releaseExpiredSeatHolds(now = new Date()) {
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
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cart/items — add item to cart
// Two modes:
//   - General admission: { ticketTypeId, quantity }
//   - Assigned seating: { ticketTypeId, seatIds: [seatUuid, ...] } — one cart_item per seat
app.post('/api/cart/items', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { ticketTypeId, quantity, seatIds } = req.body;
    await releaseExpiredSeatHolds();
    if (!ticketTypeId) {
      res.status(400).json({ error: 'ticketTypeId es requerido' });
      return;
    }

    const ticketType = await prisma.event_ticket_types.findUnique({ where: { id: ticketTypeId } });
    if (!ticketType) {
      res.status(404).json({ error: 'Tipo de boleta no encontrado' });
      return;
    }

    const cart = await getOrCreateCart(userId);
    const hasSeatIds = Array.isArray(seatIds) && seatIds.length > 0;

    if (hasSeatIds) {
      // Assigned seating: one cart_item per seat. Mark each inventory row as HELD.
      if (!ticketType.event_id) {
        res.status(400).json({ error: 'Ticket type sin evento' });
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
        res.status(400).json({ error: 'Uno o más asientos no existen en el inventario del evento' });
        return;
      }

      const expiresAt = buildSeatHoldExpiration();
      const createdCartItems = await prisma.$transaction(async (tx) => {
        const cartItems: any[] = [];

        for (const inv of inventoryRows) {
          const reserved = await tx.event_seat_inventory.updateMany({
            where: { id: inv.id, status: 'AVAILABLE' },
            data: { status: 'HELD', updated_at: new Date() },
          });

          if (evaluateAtomicSeatReservation(1, reserved.count) !== 'OK') {
            throw new SeatReservationConflictError();
          }

          await tx.seat_holds.create({
            data: {
              cart_id: cart.id,
              event_seat_inventory_id: inv.id,
              expires_at: expiresAt,
              status: 'ACTIVE',
            },
          });

          const item = await tx.cart_items.create({
            data: {
              cart_id: cart.id,
              event_seat_inventory_id: inv.id,
              quantity: 1,
              unit_price_amount: ticketType.price_amount,
              service_fee_amount: ticketType.service_fee_amount,
            },
            include: cartItemIncludes,
          });

          cartItems.push(item);
        }

        return cartItems;
      });

      // Return the last cart_item created (or all of them — frontend treats them individually)
      const last = createdCartItems[createdCartItems.length - 1];
      res.json(toCartItemDto(last));
      return;
    }

    // General admission flow (unchanged)
    if (!quantity || quantity < 1) {
      res.status(400).json({ error: 'quantity es requerido para admisión general' });
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
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('[CART] POST error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/cart/items/:id — update quantity
app.patch('/api/cart/items/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { quantity } = req.body;
    if (!quantity || quantity < 1) {
      res.status(400).json({ error: 'quantity debe ser >= 1' });
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
      res.status(404).json({ error: 'Item de carrito no encontrado' });
      return;
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('[CART] PATCH error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cart/items/:id — remove single item (releases HELD inventory)
app.delete('/api/cart/items/:id', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const item = await prisma.cart_items.findFirst({
      where: {
        id: req.params.id as string,
        carts: { is: { user_id: userId, status: 'ACTIVE' } },
      },
      select: { id: true, cart_id: true, event_seat_inventory_id: true },
    });
    if (!item) {
      res.status(404).json({ error: 'Item de carrito no encontrado' });
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
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cart/clear — remove all items from active cart (releases HELD inventory)
app.delete('/api/cart/clear', authMiddleware, async (req, res) => {
  try {
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
    res.status(500).json({ error: error.message });
  }
});

// --- CHECKOUT ENDPOINTS (simulated payment for thesis demo) ---

// POST /api/checkout/preview — validate cart, return totals
app.post('/api/checkout/preview', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    await releaseExpiredSeatHolds();
    const cart = await prisma.carts.findFirst({
      where: { user_id: userId, status: 'ACTIVE' },
      include: { cart_items: { include: { event_ticket_types: true } } },
    });
    if (!cart || cart.cart_items.length === 0) {
      res.status(400).json({ error: 'El carrito está vacío' });
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
    res.status(500).json({ error: error.message });
  }
});

// POST /api/checkout/confirm — create order from cart
app.post('/api/checkout/confirm', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { buyerEmail, buyerPhone, paymentMethod } = req.body;
    const requestedIdempotencyKey = normalizeIdempotencyKey(req.body?.idempotencyKey ?? req.headers['idempotency-key']);
    await releaseExpiredSeatHolds();

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

    if (requestedIdempotencyKey) {
      const orderNumber = buildSimulatedOrderNumber(requestedIdempotencyKey);
      const existingOrder = await prisma.orders.findFirst({
        where: { user_id: userId, order_number: orderNumber },
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
      res.status(400).json({ error: 'El carrito está vacío' });
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
        res.status(409).json({ error: 'La reserva de uno o más asientos expiró o ya no está disponible' });
        return;
      }
    }

    let order;
    if (seatInventoryIdsToSell.length > 0) {
      order = await prisma.$transaction(async (tx) => {
        await tx.seat_holds.updateMany({
          where: {
            cart_id: cart.id,
            event_seat_inventory_id: { in: seatInventoryIdsToSell },
            status: 'ACTIVE',
          },
          data: { status: 'CONSUMED', updated_at: now },
        });
        const soldSeats = await tx.event_seat_inventory.updateMany({
          where: { id: { in: seatInventoryIdsToSell }, status: 'HELD' },
          data: { status: 'SOLD', updated_at: now },
        });

        if (evaluateAtomicSeatSale(seatInventoryIdsToSell.length, soldSeats.count) !== 'OK') {
          throw new CheckoutSeatSaleConflictError();
        }

        const createdOrder = await tx.orders.create({
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
        });
        await tx.carts.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });
        return createdOrder;
      });
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

    res.json(formatCheckoutOrderResponse(order, false));
  } catch (error: any) {
    if (error instanceof CheckoutSeatSaleConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error?.code === 'P2002') {
      const userId = (req as any).userId;
      const requestedIdempotencyKey = normalizeIdempotencyKey(req.body?.idempotencyKey ?? req.headers['idempotency-key']);
      if (requestedIdempotencyKey) {
        const existingOrder = await prisma.orders.findFirst({
          where: { user_id: userId, order_number: buildSimulatedOrderNumber(requestedIdempotencyKey) },
        });
        if (existingOrder) {
          res.json(formatCheckoutOrderResponse(existingOrder, true));
          return;
        }
      }
    }
    console.error('[CHECKOUT] Confirm error:', error);
    res.status(500).json({ error: error.message });
  }
});

function formatCheckoutOrderResponse(order: {
  id: string;
  order_number: string;
  subtotal_amount: unknown;
  service_fee_amount: unknown;
  total_amount: unknown;
}, idempotentReplay: boolean) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    subtotal: Number(order.subtotal_amount),
    serviceFees: Number(order.service_fee_amount),
    total: Number(order.total_amount),
    status: 'confirmed',
    paymentMode: 'SIMULATED',
    paymentStatus: 'SIMULATED_PAID',
    idempotentReplay,
    message: 'Pago simulado para demo academica; no se proceso una pasarela fiat real.',
  };
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
    res.status(500).json({ error: error.message });
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
                seats: true,
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

    res.json(tickets.map((t) => {
      const tt = t.order_items?.event_ticket_types ?? t.order_items?.event_seat_inventory?.event_ticket_types;
      const evt = tt?.events;
      const signedQrPayload = t.contract_address && t.ticket_root_id != null && t.version != null && evt?.id
        ? JSON.stringify(buildSignedTicketQrPayload({
            contractAddress: t.contract_address,
            ticketRootId: t.ticket_root_id,
            version: t.version,
            eventId: evt.id,
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
        // Web3 fields
        isSecuredOnChain: Boolean(t.contract_address),
        isForSale: t.is_for_sale ?? false,
        contractAddress: t.contract_address,
        ticketRootId: t.ticket_root_id,
        version: t.version,
        ownerWallet: t.owner_wallet,
        resalePrice: t.resale_price ? Number(t.resale_price) : null,
        nftContractAddress: (evt as any)?.nft_contract_address ?? null,
        nftTokenId: (t as any).nft_token_id ?? null,
        qrPayload: signedQrPayload,
      };
    }));
  } catch (error: any) {
    console.error('[TICKETS] GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tickets/sold — tickets the user sold via resale
app.get('/api/tickets/sold', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    // Sold tickets = CANCELLED + had a resale_price (distinguishes from invalidated)
    const tickets = await prisma.tickets.findMany({
      where: {
        owner_user_id: userId,
        status: 'CANCELLED',
        resale_price: { not: null },
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
    res.status(500).json({ error: error.message });
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
