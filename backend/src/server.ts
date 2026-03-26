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

// START THE SERVER
app.listen(PORT, () => {
  console.log(`[HTTP] Express server listening on http://localhost:${PORT}`);
  
  // Start the background indexer loop
  runIndexer().catch(err => console.error('[INDEXER] Fatal Error:', err));
});
