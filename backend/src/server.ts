import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { runIndexer } from './indexer';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'stellar-tickets-backend' });
});

// --- WEB2 CATALOG ENDPOINTS ---

// GET /api/events - List published events
app.get('/api/events', async (req, res) => {
  try {
    const events = await prisma.events.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        venues: { include: { cities: true } },
        event_ticket_types: { where: { is_active: true } }
      },
      orderBy: { starts_at: 'asc' }
    });
    res.json(events);
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
      include: {
        venues: { include: { cities: true } },
        organizers: true,
        event_ticket_types: { where: { is_active: true } }
      }
    });

    if (!event) {
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }
    
    // Fetch live ticket data mapped from Web3 contract via indexer
    let tickets: any[] = [];
    if (event.contract_address) {
       tickets = await prisma.tickets.findMany({
         where: { contract_address: event.contract_address, is_for_sale: true }
       });
    }
    
    res.json({ ...event, live_tickets: tickets });
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

// --- MOCK WEB2 API ENDPOINTS FOR FRONTEND COMPATIBILITY ---
app.post('/api/auth/login', async (req, res) => {
  const { email } = req.body;
  const user = await prisma.users.findFirst({ where: { email } });
  
  if (user) {
    res.json({ accessToken: 'fake-jwt-token', user: { id: user.id, firstName: user.first_name, lastName: user.last_name, email: user.email, documentNumber: user.document_number, documentType: user.document_type || 'CC', phone: user.phone || '' } });
  } else {
    res.json({ accessToken: 'fake-jwt-token', user: { id: '1234abcd-1234-1234-1234-1234567890ab', firstName: 'Usuario', lastName: 'Demo', email, documentNumber: '12345678', documentType: 'CC', phone: '3000000000' } });
  }
});

app.post('/api/auth/register', (req, res) => {
  res.json({ accessToken: 'fake-jwt-token', user: { id: '1234abcd-1234-1234-1234-1234567890ab', firstName: req.body.firstName || 'Nuevo', lastName: req.body.lastName || 'Usuario', email: req.body.email, documentNumber: req.body.documentNumber || '123', documentType: 'CC', phone: '000' } });
});

app.get('/api/users/me', (req, res) => {
   res.json({ id: '1234abcd-1234-1234-1234-1234567890ab', firstName: 'Usuario', lastName: 'Activo', email: 'demo@demo.com', documentNumber: '12345678', documentType: 'CC', phone: '3000000000' });
});

app.post('/api/checkout/preview', (req, res) => res.json({}));
app.post('/api/checkout/confirm', async (req, res) => {
  res.json({ id: `ord-${Date.now()}`, orderNumber: `TT-${Date.now()}` });
});
app.get('/api/orders', (req, res) => res.json([]));
app.get('/api/tickets', async (req, res) => {
  res.json([]);
});

// Cart mock
app.get('/api/cart', (req, res) => res.json([]));
app.post('/api/cart/items', (req, res) => res.status(204).send());
app.delete('/api/cart/items/:id', (req, res) => res.status(204).send());
app.patch('/api/cart/items/:id', (req, res) => res.status(204).send());
app.delete('/api/cart/clear', (req, res) => res.status(204).send());

// START THE SERVER
app.listen(PORT, () => {
  console.log(`[HTTP] Express server listening on http://localhost:${PORT}`);
  
  // Start the background indexer loop
  runIndexer().catch(err => console.error('[INDEXER] Fatal Error:', err));
});
