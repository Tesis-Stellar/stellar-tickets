import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
       live_tickets = await prisma.tickets.findMany({
         where: { contract_address: event.contract_address, is_for_sale: true }
       });
    }

    res.json({ ...toEventDto(event), live_tickets });
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
