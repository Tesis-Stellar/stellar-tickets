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
  Operation,
  Account,
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { runIndexer } from './indexer';

dotenv.config();

// BigInt fields (e.g. cities.id) are not JSON-serializable by default
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'stellar-tickets-dev-secret-change-in-prod';
const JWT_EXPIRES_IN = '7d';

// Soroban / Stellar config
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

// Organizer keypair for on-chain operations (from deploy)
const ORGANIZER_SECRET = process.env.ORGANIZER_SECRET;
const organizerKeypair = ORGANIZER_SECRET ? Keypair.fromSecret(ORGANIZER_SECRET) : null;

// Helper: build user DTO for frontend
function toUserDto(user: { id: string; first_name: string; last_name: string; email: string; phone: string | null; document_type: string; document_number: string }) {
  return {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    phone: user.phone || '',
    documentType: user.document_type,
    documentNumber: user.document_number,
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
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

app.use(cors());
app.use(express.json());

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
    const events = await prisma.events.findMany({
      where: { status: 'PUBLISHED' },
      include: eventIncludes,
      orderBy: { starts_at: 'asc' }
    });
    res.json(events.map(toEventDto));
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/featured - Featured events
app.get('/api/events/featured', async (req, res) => {
  try {
    const events = await prisma.events.findMany({
      where: { status: 'PUBLISHED' },
      include: eventIncludes,
      orderBy: { starts_at: 'asc' },
      take: 6,
    });
    res.json(events.map(toEventDto));
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:slug - Event details
app.get('/api/events/:slug', async (req, res) => {
  try {
    const event = await prisma.events.findFirst({
      where: { slug: req.params.slug },
      include: eventIncludes,
    });

    if (!event) {
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }

    // Fetch live ticket data mapped from Web3 contract via indexer
    let live_tickets: any[] = [];
    if (event.contract_address) {
       const rawTickets = await prisma.tickets.findMany({
         where: { contract_address: event.contract_address, is_for_sale: true, status: 'ACTIVE' },
         select: {
           id: true, ticket_root_id: true, version: true, owner_wallet: true, contract_address: true,
         },
       });
       live_tickets = rawTickets.map(t => ({
         id: t.id,
         ticketRootId: t.ticket_root_id,
         version: t.version,
         sellerWallet: t.owner_wallet,
         contractAddress: t.contract_address,
       }));
    }

    res.json({ ...toEventDto(event), live_tickets, contractAddress: event.contract_address });
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

// GET /api/events/:id/related - Related events (same category)
app.get('/api/events/:id/related', async (req, res) => {
  try {
    const event = await prisma.events.findUnique({ where: { id: req.params.id }, select: { category_id: true } });
    if (!event) { res.json([]); return; }
    const related = await prisma.events.findMany({
      where: { category_id: event.category_id, status: 'PUBLISHED', id: { not: req.params.id } },
      include: eventIncludes,
      take: 4,
    });
    res.json(related.map(toEventDto));
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

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
// The organizer signs crear_boleto server-side, proving the ticket exists on-chain
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

    const event = ticket.order_items?.event_ticket_types?.events;
    if (!event?.contract_address) {
      res.status(400).json({ error: 'Evento sin contrato desplegado' });
      return;
    }

    const contractAddress = event.contract_address;
    const price = Number(ticket.order_items?.event_ticket_types?.price_amount || 0);

    // Build and submit crear_boleto transaction
    console.log(`[SOROBAN] Creating ticket on-chain for contract ${contractAddress.slice(0, 8)}...`);

    const accountResponse = await sorobanServer.getAccount(organizerKeypair.publicKey());
    const account = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

    const tx = new TransactionBuilder(account, {
      fee: '10000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.invokeContractFunction({
        contract: contractAddress,
        function: 'crear_boleto',
        args: [
          nativeToScVal(1, { type: 'u32' }),        // id_evento (1 for all, each contract is per-event)
          nativeToScVal(price, { type: 'i128' }),    // precio
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
        owner_wallet: organizerKeypair.publicKey(),
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

// POST /api/transactions/list-ticket — List a ticket for resale on Soroban
app.post('/api/transactions/list-ticket', authMiddleware, async (req, res) => {
  try {
    if (!organizerKeypair) {
      res.status(503).json({ error: 'Blockchain no configurada' });
      return;
    }

    const { ticketId, price } = req.body; // price in XLM stroops (1 XLM = 10_000_000)
    if (!ticketId || !price || price <= 0) {
      res.status(400).json({ error: 'ticketId y price son requeridos' });
      return;
    }

    const ticket = await prisma.tickets.findUnique({ where: { id: ticketId } });
    if (!ticket) { res.status(404).json({ error: 'Ticket no encontrado' }); return; }
    if (ticket.owner_user_id !== (req as any).userId) { res.status(403).json({ error: 'No autorizado' }); return; }
    if (!ticket.contract_address || ticket.ticket_root_id === null) { res.status(400).json({ error: 'Ticket no registrado en blockchain' }); return; }
    if (ticket.is_for_sale) { res.status(409).json({ error: 'Ticket ya está en venta' }); return; }

    console.log(`[SOROBAN] Listing ticket root_id=${ticket.ticket_root_id} for ${price} stroops...`);

    const accountResponse = await sorobanServer.getAccount(organizerKeypair.publicKey());
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
      console.error('[SOROBAN] List simulation failed:', (simResponse as any).error);
      res.status(500).json({ error: 'Error en simulación blockchain' });
      return;
    }

    const assembled = SorobanRpc.assembleTransaction(tx, simResponse).build();
    assembled.sign(organizerKeypair);

    const sendResponse = await sorobanServer.sendTransaction(assembled);
    if (sendResponse.status === 'ERROR') {
      res.status(500).json({ error: 'Error enviando transacción' });
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
      res.status(500).json({ error: 'Transacción de listado fallida' });
      return;
    }

    // Optimistic DB update (indexer will also pick this up)
    await prisma.tickets.update({
      where: { id: ticketId },
      data: { is_for_sale: true },
    });

    console.log(`[SOROBAN] Ticket listed! root_id=${ticket.ticket_root_id}, tx=${sendResponse.hash}`);
    res.json({ success: true, txHash: sendResponse.hash });
  } catch (error: any) {
    console.error('[SOROBAN] list-ticket error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transactions/build-buy-xdr — Build unsigned XDR for comprar_boleto (Freighter signs)
app.post('/api/transactions/build-buy-xdr', authMiddleware, async (req, res) => {
  try {
    const { contractAddress, ticketRootId, buyerPublicKey } = req.body;
    if (!contractAddress || ticketRootId === undefined || !buyerPublicKey) {
      res.status(400).json({ error: 'contractAddress, ticketRootId y buyerPublicKey son requeridos' });
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
      console.error('[SOROBAN] Buy simulation failed:', (simResponse as any).error);
      res.status(500).json({ error: 'Error en simulación: ' + ((simResponse as any).error || 'desconocido') });
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
    const { signedXdr } = req.body;
    if (!signedXdr) {
      res.status(400).json({ error: 'signedXdr es requerido' });
      return;
    }

    const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

    const sendResponse = await sorobanServer.sendTransaction(tx);
    if (sendResponse.status === 'ERROR') {
      console.error('[SOROBAN] Submit failed:', sendResponse);
      res.status(500).json({ error: 'Error enviando transacción firmada' });
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
      res.status(500).json({ error: 'Transacción fallida: ' + getResponse.status });
      return;
    }

    console.log(`[SOROBAN] Signed tx submitted! hash=${sendResponse.hash}`);
    res.json({ success: true, txHash: sendResponse.hash });
  } catch (error: any) {
    console.error('[SOROBAN] submit error:', error);
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

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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

    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
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
  return {
    id: item.id,
    quantity: item.quantity,
    seatIds: [] as string[],
    ticketType: tt ? {
      id: tt.id,
      name: tt.ticket_type_name,
      price: Number(tt.price_amount),
      serviceFee: Number(tt.service_fee_amount),
    } : undefined,
    event: evt ? toEventDto(evt) : undefined,
  };
}

const cartItemIncludes = {
  event_ticket_types: {
    include: {
      events: { include: eventIncludes },
    },
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
app.post('/api/cart/items', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const { ticketTypeId, quantity } = req.body;
    if (!ticketTypeId || !quantity || quantity < 1) {
      res.status(400).json({ error: 'ticketTypeId y quantity son requeridos' });
      return;
    }

    const ticketType = await prisma.event_ticket_types.findUnique({ where: { id: ticketTypeId } });
    if (!ticketType) {
      res.status(404).json({ error: 'Tipo de boleta no encontrado' });
      return;
    }

    const cart = await getOrCreateCart(userId);
    const item = await prisma.cart_items.create({
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
    const { quantity } = req.body;
    if (!quantity || quantity < 1) {
      res.status(400).json({ error: 'quantity debe ser >= 1' });
      return;
    }
    await prisma.cart_items.update({ where: { id: req.params.id as string }, data: { quantity } });
    res.status(204).send();
  } catch (error: any) {
    console.error('[CART] PATCH error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cart/items/:id — remove single item
app.delete('/api/cart/items/:id', authMiddleware, async (req, res) => {
  try {
    await prisma.cart_items.delete({ where: { id: req.params.id as string } });
    res.status(204).send();
  } catch (error: any) {
    console.error('[CART] DELETE error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cart/clear — remove all items from active cart
app.delete('/api/cart/clear', authMiddleware, async (req, res) => {
  try {
    const userId = (req as any).userId;
    const cart = await prisma.carts.findFirst({ where: { user_id: userId, status: 'ACTIVE' } });
    if (cart) {
      await prisma.cart_items.deleteMany({ where: { cart_id: cart.id } });
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

    // Create order + order_items + payment + tickets in a transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.orders.create({
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
        },
      });

      // Create order_items and tickets for each cart item
      for (const cartItem of cart.cart_items) {
        const orderItem = await tx.order_items.create({
          data: {
            order_id: newOrder.id,
            event_ticket_type_id: cartItem.event_ticket_type_id,
            quantity: cartItem.quantity,
            unit_price_amount: cartItem.unit_price_amount,
            service_fee_amount: cartItem.service_fee_amount,
          },
        });

        // Create one ticket per quantity unit
        for (let i = 0; i < cartItem.quantity; i++) {
          const ticketCode = `TK-${randPart}-${orderItem.id.slice(-4).toUpperCase()}-${i + 1}`;
          await tx.tickets.create({
            data: {
              order_item_id: orderItem.id,
              owner_user_id: userId,
              ticket_code: ticketCode,
              status: 'ACTIVE',
            },
          });
        }
      }

      // Create payment record (simulated as PAID for thesis demo)
      await tx.payments.create({
        data: {
          order_id: newOrder.id,
          payment_method: paymentMethod || 'CARD',
          status: 'PAID',
          amount: total,
          processed_at: now,
        },
      });

      // Mark cart as CONVERTED
      await tx.carts.update({ where: { id: cart.id }, data: { status: 'CONVERTED' } });

      return newOrder;
    });

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
      };
    }));
  } catch (error: any) {
    console.error('[TICKETS] GET error:', error);
    res.status(500).json({ error: error.message });
  }
});

// START THE SERVER
app.listen(PORT, () => {
  console.log(`[HTTP] Express server listening on http://localhost:${PORT}`);
  
  // Start the background indexer loop
  runIndexer().catch(err => console.error('[INDEXER] Fatal Error:', err));
});
