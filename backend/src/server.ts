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
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { runIndexer } from './indexer';
import { exec } from 'child_process';
import util from 'util';

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

const EFFECTIVE_JWT_SECRET = configuredJwtSecret || 'stellar-tickets-dev-secret-change-in-prod';
if (!configuredJwtSecret) {
  console.warn('[WARN] JWT_SECRET is not set. Using insecure development fallback; do not use this in shared, demo, or production environments.');
}
const JWT_EXPIRES_IN = '7d';

// Soroban / Stellar config
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

// Organizer keypair for on-chain operations (from deploy)
const ORGANIZER_SECRET = process.env.ORGANIZER_SECRET;
const organizerKeypair = ORGANIZER_SECRET ? Keypair.fromSecret(ORGANIZER_SECRET) : null;

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
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), EFFECTIVE_JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

app.use(cors());
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
           id: true, ticket_root_id: true, version: true, owner_wallet: true, contract_address: true, resale_price: true,
         },
       });
       live_tickets = rawTickets.map(t => ({
         id: t.id,
         ticketRootId: t.ticket_root_id,
         version: t.version,
         sellerWallet: t.owner_wallet,
         contractAddress: t.contract_address,
         resalePrice: t.resale_price ? Number(t.resale_price) : null,
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

    res.json({ ...toEventDto(event), live_tickets, contractAddress: event.contract_address, ticketTypes });
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

    const event = ticket.order_items?.event_ticket_types?.events;
    if (!event?.contract_address) {
      res.status(400).json({ error: 'Evento sin contrato desplegado' });
      return;
    }

    const contractAddress = event.contract_address;
    const price = Number(ticket.order_items?.event_ticket_types?.price_amount || 0);

    // Build and submit crear_boleto_para transaction so on-chain owner matches PostgreSQL owner_wallet
    console.log(`[SOROBAN] Creating ticket on-chain for ${ownerUser.wallet_address.slice(0, 8)} on contract ${contractAddress.slice(0, 8)}...`);

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
          nativeToScVal(1, { type: 'u32' }),              // id_evento (1 for all, each contract is per-event)
          new Address(ownerUser.wallet_address).toScVal(), // propietario on-chain
          nativeToScVal(price, { type: 'i128' }),          // precio
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
      console.error('[SOROBAN] Transaction failed:', getResponse.status);
      res.status(500).json({ error: 'Transacción blockchain fallida' });
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

    // Update DB with on-chain data
    await prisma.tickets.update({
      where: { id: ticketId },
      data: {
        contract_address: contractAddress,
        ticket_root_id: ticketRootId,
        version: 0,
        owner_wallet: ownerUser.wallet_address,
      },
    });

    console.log(`[SOROBAN] Ticket secured on-chain! root_id=${ticketRootId}, tx=${sendResponse.hash}`);

    res.json({
      success: true,
      txHash: sendResponse.hash,
      contractAddress,
      ticketRootId,
      network: 'TESTNET',
    });
  } catch (error: any) {
    console.error('[SOROBAN] secure-ticket error:', error);
    res.status(500).json({ error: error.message });
  }
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
    res.json({ xdr: assembled.toXDR(), networkPassphrase: NETWORK_PASSPHRASE });
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
    res.json({ xdr: assembled.toXDR(), networkPassphrase: NETWORK_PASSPHRASE });
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

    console.log(`[SOROBAN] XDR built for buy, ${xdrBase64.length} chars`);
    res.json({ xdr: xdrBase64, networkPassphrase: NETWORK_PASSPHRASE });
  } catch (error: any) {
    console.error('[SOROBAN] build-buy-xdr error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transactions/submit — Submit Freighter-signed XDR to Soroban
app.post('/api/transactions/submit', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { signedXdr } = req.body;
    if (!signedXdr) {
      res.status(400).json({ error: 'signedXdr es requerido' });
      return;
    }

    const user = await prisma.users.findUnique({ where: { id: userId }, select: { wallet_address: true } });
    if (!user?.wallet_address) {
      res.status(400).json({ error: 'Debes vincular una wallet antes de enviar una transacción' });
      return;
    }

    const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    if (tx instanceof FeeBumpTransaction) {
      res.status(400).json({ error: 'Las transacciones fee-bump no están soportadas en este endpoint' });
      return;
    }
    if (tx.source !== user.wallet_address) {
      res.status(403).json({ error: 'La transacción firmada no corresponde a la wallet vinculada al usuario' });
      return;
    }

    const sendResponse = await sorobanServer.sendTransaction(tx);
    if (sendResponse.status === 'ERROR') {
      console.error('[SOROBAN] Submit failed:', sendResponse);
      res.status(400).json({ error: 'La red rechazó la transacción firmada' });
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
      res.status(400).json({ error: 'Transacción fallida: ' + getResponse.status });
      return;
    }

    console.log(`[SOROBAN] Signed tx submitted! hash=${sendResponse.hash}`);
    res.json({ success: true, txHash: sendResponse.hash });
  } catch (error: any) {
    console.error('[SOROBAN] submit error:', error);
    res.status(500).json({ error: error.message });
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
app.post('/api/admin/scan', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: (req as any).userId } });
    if (!user || !['ADMIN', 'STAFF'].includes(user.role)) { res.status(403).json({ error: 'Acceso denegado' }); return; }

    const { ticketId } = req.body;
    if (!ticketId) { res.status(400).json({ error: 'ticketId es requerido' }); return; }

    // Check if the ticket exists
    const ticket = await prisma.tickets.findUnique({ where: { id: ticketId } });
    
    if (!ticket) {
      res.status(404).json({ error: 'Boleto no encontrado en la base de datos' });
      return;
    }

    if (ticket.status !== 'ACTIVE') {
      res.status(400).json({ error: `Boleto inhabilitado: ${ticket.status}` });
      return;
    }

    // In a real Web3 environment, if ticket.contract_address exists, we'd trigger a Soroban burn here via CLI
    // For this simulation/hybrid speed, we update Postgres linearly to avoid gate delays.
    await prisma.tickets.update({
       where: { id: ticket.id },
       data: { status: 'CANCELLED' } // 'CANCELLED' is the generic inactive state in Prisma schema for this thesis demo
    });

    res.json({ success: true, message: 'Boleto redimido exitosamente' });
  } catch (error: any) {
    console.error('[SCAN] Error:', error);
    res.status(500).json({ error: error.message });
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
    if (user?.role !== 'ADMIN') { res.status(403).json({ error: 'Acceso denegado' }); return; }

    const eventId = req.params.id as string;
    const event = await prisma.events.findUnique({ where: { id: eventId } });
    if (!event) { res.status(404).json({ error: 'Evento no encontrado' }); return; }
    if (event.contract_address) { res.status(400).json({ error: 'El evento ya tiene contrato' }); return; }

    // Run the Soroban deploy script inside Node Environment
    const { stdout, stderr } = await execPromise('npx tsx scripts/deploy-contracts.ts', { cwd: require('path').resolve(__dirname, '..') });
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
    res.status(500).json({ error: error.message });
  }
});

// --- AUTH ENDPOINTS ---
app.post('/api/auth/login', async (req, res) => {
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

app.post('/api/auth/register', async (req, res) => {
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

// PATCH /api/users/me/wallet — link Freighter wallet to user account
app.patch('/api/users/me/wallet', authMiddleware, async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) { res.status(400).json({ error: 'walletAddress requerido' }); return; }
    const user = await prisma.users.update({
      where: { id: (req as any).userId },
      data: { wallet_address: walletAddress },
    });
    res.json({ walletAddress: user.wallet_address });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'Wallet ya vinculada a otra cuenta' });
      return;
    }
    console.error('[AUTH] Link wallet error:', error);
    res.status(500).json({ error: error.message });
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

// Helper: transform cart_items rows into the shape the frontend expects
function toCartItemDto(item: any) {
  const tt = item.event_ticket_types;
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
    include: { seats: true },
  },
};

// GET /api/cart — list items in user's active cart
app.get('/api/cart', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
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

      const unavailable = inventoryRows.filter((r) => r.status !== 'AVAILABLE');
      if (unavailable.length > 0) {
        res.status(409).json({ error: 'Uno o más asientos ya no están disponibles' });
        return;
      }

      const created = await prisma.$transaction(
        inventoryRows.flatMap((inv) => [
          prisma.event_seat_inventory.update({
            where: { id: inv.id },
            data: { status: 'HELD' },
          }),
          prisma.cart_items.create({
            data: {
              cart_id: cart.id,
              event_ticket_type_id: ticketTypeId,
              event_seat_inventory_id: inv.id,
              quantity: 1,
              unit_price_amount: ticketType.price_amount,
              service_fee_amount: ticketType.service_fee_amount,
            },
            include: cartItemIncludes,
          }),
        ])
      );

      // Return the last cart_item created (or all of them — frontend treats them individually)
      const cartItems = created.filter((r: any) => r && r.cart_id);
      const last = cartItems[cartItems.length - 1];
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
      select: { id: true, event_seat_inventory_id: true },
    });
    if (!item) {
      res.status(404).json({ error: 'Item de carrito no encontrado' });
      return;
    }

    if (item.event_seat_inventory_id) {
      await prisma.$transaction([
        prisma.event_seat_inventory.update({
          where: { id: item.event_seat_inventory_id },
          data: { status: 'AVAILABLE' },
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
        ops.push(
          prisma.event_seat_inventory.updateMany({
            where: { id: { in: heldInventoryIds }, status: 'HELD' },
            data: { status: 'AVAILABLE' },
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

// --- CHECKOUT ENDPOINTS (real) ---

// POST /api/checkout/preview — validate cart, return totals
app.post('/api/checkout/preview', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
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

    res.json({ subtotal, serviceFees, total: subtotal + serviceFees, itemCount: cart.cart_items.length });
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

    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado' }); return; }

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

    // Generate order number: TT-YYYYMMDD-XXXXX
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randPart = Math.random().toString(36).slice(2, 7).toUpperCase();
    const orderNumber = `TT-${datePart}-${randPart}`;

    const orderItemCreates = cart.cart_items.map((cartItem) => ({
      event_ticket_type_id: cartItem.event_ticket_type_id,
      event_seat_inventory_id: cartItem.event_seat_inventory_id,
      quantity: cartItem.quantity,
      unit_price_amount: cartItem.unit_price_amount,
      service_fee_amount: cartItem.service_fee_amount,
      tickets: {
        create: Array.from({ length: cartItem.quantity }, (_, i) => ({
          owner_user_id: userId,
          ticket_code: `TK-${randPart}-${cartItem.id.slice(-4).toUpperCase()}-${i + 1}`,
          status: 'ACTIVE' as const,
        })),
      },
    }));

    const seatInventoryIdsToSell = cart.cart_items
      .map((i) => i.event_seat_inventory_id)
      .filter((v): v is string => Boolean(v));

    // Use a batch transaction instead of an interactive tx callback. Supabase/pgBouncer
    // can drop long-lived interactive transactions in local/demo environments.
    const ops: any[] = [
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
              processed_at: now,
            },
          },
        },
      }),
      prisma.carts.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } }),
    ];

    if (seatInventoryIdsToSell.length > 0) {
      ops.push(
        prisma.event_seat_inventory.updateMany({
          where: { id: { in: seatInventoryIdsToSell } },
          data: { status: 'SOLD' },
        })
      );
    }

    const [order] = await prisma.$transaction(ops);

    res.json({
      id: order.id,
      orderNumber: order.order_number,
      subtotal: Number(order.subtotal_amount),
      serviceFees: Number(order.service_fee_amount),
      total: Number(order.total_amount),
    });
  } catch (error: any) {
    console.error('[CHECKOUT] Confirm error:', error);
    res.status(500).json({ error: error.message });
  }
});

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
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json(tickets.map((t) => {
      const tt = t.order_items?.event_ticket_types;
      const evt = tt?.events;
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
          },
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    // For each sold ticket, find the buyer (next version of same ticket_root_id)
    const results = await Promise.all(tickets.map(async (t) => {
      const tt = t.order_items?.event_ticket_types;
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
