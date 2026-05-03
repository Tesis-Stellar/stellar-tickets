/**
 * seed-seats.ts
 * Popula el Supabase de TEST con secciones y asientos para 2 eventos.
 * Evento 1 → venue tipo STADIUM  (ej: clasico-capital-2026)
 * Evento 2 → venue tipo THEATER  (ej: obra-clasica-medellin-2026)
 *
 * Uso:
 *   cd backend
 *   node --import tsx scripts/seed-seats.ts
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

// ── helpers ────────────────────────────────────────────────────────────────

function makeSeats(rows: string[], seatsPerRow: number) {
  const seats: { row: string; number: number; label: string }[] = [];
  for (const row of rows) {
    for (let n = 1; n <= seatsPerRow; n++) {
      seats.push({ row, number: n, label: `${row}${n}` });
    }
  }
  return seats;
}

async function ensureSection(
  venueId: string,
  name: string,
  code: string,
  capacity: number,
  hasNumberedSeats: boolean,
) {
  const existing = await prisma.venue_sections.findFirst({
    where: { venue_id: venueId, section_code: code },
  });
  if (existing) return existing;
  return prisma.venue_sections.create({
    data: { venue_id: venueId, section_name: name, section_code: code, capacity, has_numbered_seats: hasNumberedSeats },
  });
}

async function ensureSeats(sectionId: string, seats: { row: string; number: number; label: string }[]) {
  const created: any[] = [];
  for (const s of seats) {
    const existing = await prisma.seats.findFirst({
      where: {
        venue_section_id: sectionId,
        OR: [
          { seat_label: s.label },
          { row_label: s.row, seat_number: s.number },
        ],
      },
    });
    if (existing) { created.push(existing); continue; }
    const seat = await prisma.seats.create({
      data: { venue_section_id: sectionId, row_label: s.row, seat_number: s.number, seat_label: s.label },
    });
    created.push(seat);
  }
  return created;
}

async function ensureTicketType(
  eventId: string,
  sectionId: string,
  name: string,
  price: number,
  fee: number,
  maxPerOrder: number,
) {
  const existing = await prisma.event_ticket_types.findFirst({
    where: { event_id: eventId, ticket_type_name: name },
  });
  if (existing) {
    // make sure it points to correct section
    return prisma.event_ticket_types.update({ where: { id: existing.id }, data: { venue_section_id: sectionId } });
  }
  return prisma.event_ticket_types.create({
    data: {
      event_id: eventId,
      venue_section_id: sectionId,
      ticket_type_name: name,
      price_amount: price,
      service_fee_amount: fee,
      max_per_order: maxPerOrder,
      inventory_quantity: null,
      is_active: true,
    },
  });
}

async function ensureInventory(eventId: string, seatId: string, ticketTypeId: string) {
  const existing = await prisma.event_seat_inventory.findFirst({
    where: { event_id: eventId, seat_id: seatId },
  });
  if (existing) return existing;
  return prisma.event_seat_inventory.create({
    data: { event_id: eventId, seat_id: seatId, event_ticket_type_id: ticketTypeId, status: 'AVAILABLE' },
  });
}

// ── main ───────────────────────────────────────────────────────────────────

async function findEvent(slug: string) {
  const ev = await prisma.events.findFirst({ where: { slug }, include: { venues: true } });
  if (!ev) {
    // fallback: first published event matching title keyword
    return null;
  }
  return ev;
}

async function main() {
  // ── Resolve events by slug ────────────────────────────────────────────────
  // STADIUM: fútbol → clasico-capital-2026
  // THEATER: obra de teatro → obra-clasica-medellin-2026
  // THEATER 2: stand-up → noche-standup-medellin-2026 (mismo venue Teatro Metro que Obra Clásica)

  const stadiumSlug = 'clasico-capital-2026';
  const theater1Slug = 'obra-clasica-medellin-2026';
  const theater2Slug = 'noche-standup-medellin-2026';

  let ev1 = await findEvent(stadiumSlug);
  let ev2 = await findEvent(theater1Slug);
  let ev3 = await findEvent(theater2Slug);

  // Fallback: if slugs not found use first 3 published events
  if (!ev1 || !ev2) {
    const fallback = await prisma.events.findMany({
      where: { status: 'PUBLISHED' },
      include: { venues: true },
      take: 3,
      orderBy: { starts_at: 'asc' },
    });
    if (!ev1) ev1 = fallback[0] ?? null;
    if (!ev2) ev2 = fallback[1] ?? null;
    if (!ev3) ev3 = fallback[2] ?? null;
  }

  if (!ev1 || !ev2) {
    console.error('No se encontraron suficientes eventos publicados.');
    process.exit(1);
  }

  console.log(`Evento STADIUM → ${ev1.title} (venue: ${ev1.venues.name})`);
  console.log(`Evento THEATER → ${ev2.title} (venue: ${ev2.venues.name})`);
  if (ev3) console.log(`Evento THEATER 2 → ${ev3.title} (venue: ${ev3.venues.name})`);

  // ── STADIUM event ──────────────────────────────────────────────────────
  await prisma.venues.update({ where: { id: ev1.venues.id }, data: { venue_type: 'STADIUM' } });
  await prisma.events.update({ where: { id: ev1.id }, data: { has_assigned_seating: true } });

  // 3 sections: PALCO (2 rows × 10), PLATEA (4 rows × 15), GENERAL (3 rows × 20)
  const palco   = await ensureSection(ev1.venues.id, 'Palco VIP', 'PALCO',   20,  true);
  const platea  = await ensureSection(ev1.venues.id, 'Platea',    'PLATEA',  60,  true);
  const general = await ensureSection(ev1.venues.id, 'General',   'GENERAL', 60,  true);

  const palcoSeats   = await ensureSeats(palco.id,   makeSeats(['A','B'], 10));
  const plateaSeats  = await ensureSeats(platea.id,  makeSeats(['A','B','C','D'], 15));
  const generalSeats = await ensureSeats(general.id, makeSeats(['A','B','C'], 20));

  const ttPalco   = await ensureTicketType(ev1.id, palco.id,   'Palco VIP', 350000, 35000, 4);
  const ttPlatea  = await ensureTicketType(ev1.id, platea.id,  'Platea',    180000, 18000, 6);
  const ttGeneral = await ensureTicketType(ev1.id, general.id, 'General',    80000,  8000, 8);

  // Pre-occupy some seats for realism
  const occupiedPalco   = new Set(['A3','A7','B2','B8']);
  const occupiedPlatea  = new Set(['A1','A5','B3','B10','C7','D2']);
  const occupiedGeneral = new Set(['A4','A12','B6','C15']);

  for (const seat of palcoSeats) {
    const inv = await ensureInventory(ev1.id, seat.id, ttPalco.id);
    if (occupiedPalco.has(seat.seat_label))
      await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
  }
  for (const seat of plateaSeats) {
    const inv = await ensureInventory(ev1.id, seat.id, ttPlatea.id);
    if (occupiedPlatea.has(seat.seat_label))
      await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
  }
  for (const seat of generalSeats) {
    const inv = await ensureInventory(ev1.id, seat.id, ttGeneral.id);
    if (occupiedGeneral.has(seat.seat_label))
      await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
  }

  console.log(`✓ STADIUM seed completo: ${palcoSeats.length + plateaSeats.length + generalSeats.length} asientos`);

  // ── THEATER event ──────────────────────────────────────────────────────
  await prisma.venues.update({ where: { id: ev2.venues.id }, data: { venue_type: 'THEATER' } });
  await prisma.events.update({ where: { id: ev2.id }, data: { has_assigned_seating: true } });

  // 3 sections: PLATEA_BAJA (3×12), PLATEA_ALTA (3×14), BALCON (2×16)
  const platBaja = await ensureSection(ev2.venues.id, 'Platea Baja', 'PLATEA_BAJA', 36, true);
  const platAlta = await ensureSection(ev2.venues.id, 'Platea Alta', 'PLATEA_ALTA', 42, true);
  const balcon   = await ensureSection(ev2.venues.id, 'Balcón',      'BALCON',      32, true);

  const platBajaSeats = await ensureSeats(platBaja.id, makeSeats(['A','B','C'], 12));
  const platAltaSeats = await ensureSeats(platAlta.id, makeSeats(['D','E','F'], 14));
  const balconSeats   = await ensureSeats(balcon.id,   makeSeats(['G','H'], 16));

  const ttPlatBaja = await ensureTicketType(ev2.id, platBaja.id, 'Platea Baja', 220000, 22000, 4);
  const ttPlatAlta = await ensureTicketType(ev2.id, platAlta.id, 'Platea Alta', 140000, 14000, 6);
  const ttBalcon   = await ensureTicketType(ev2.id, balcon.id,   'Balcón',       90000,  9000, 8);

  const occupiedPlatBaja = new Set(['A2','A8','B5','B11','C3']);
  const occupiedPlatAlta = new Set(['D6','E2','E9','F4']);
  const occupiedBalcon   = new Set(['G7','H3','H12']);

  for (const seat of platBajaSeats) {
    const inv = await ensureInventory(ev2.id, seat.id, ttPlatBaja.id);
    if (occupiedPlatBaja.has(seat.seat_label))
      await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
  }
  for (const seat of platAltaSeats) {
    const inv = await ensureInventory(ev2.id, seat.id, ttPlatAlta.id);
    if (occupiedPlatAlta.has(seat.seat_label))
      await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
  }
  for (const seat of balconSeats) {
    const inv = await ensureInventory(ev2.id, seat.id, ttBalcon.id);
    if (occupiedBalcon.has(seat.seat_label))
      await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
  }

  console.log(`✓ THEATER seed completo: ${platBajaSeats.length + platAltaSeats.length + balconSeats.length} asientos`);

  // ── THEATER 2 (Noche Stand Up) — mismo venue que ev2 si existe ─────────
  if (ev3 && ev3.id !== ev2.id) {
    await prisma.events.update({ where: { id: ev3.id }, data: { has_assigned_seating: true } });
    // Reusa las secciones del mismo venue (ya existen)
    const secBaja = await ensureSection(ev3.venues.id, 'Platea Baja', 'PLATEA_BAJA', 36, true);
    const secAlta = await ensureSection(ev3.venues.id, 'Platea Alta', 'PLATEA_ALTA', 42, true);
    const secBalc = await ensureSection(ev3.venues.id, 'Balcón',      'BALCON',      32, true);

    const s3BajaSeats = await ensureSeats(secBaja.id, makeSeats(['A','B','C'], 12));
    const s3AltaSeats = await ensureSeats(secAlta.id, makeSeats(['D','E','F'], 14));
    const s3BalcSeats = await ensureSeats(secBalc.id, makeSeats(['G','H'], 16));

    const tt3Baja = await ensureTicketType(ev3.id, secBaja.id, 'Platea Baja', 180000, 18000, 4);
    const tt3Alta = await ensureTicketType(ev3.id, secAlta.id, 'Platea Alta', 110000, 11000, 6);
    const tt3Balc = await ensureTicketType(ev3.id, secBalc.id, 'Balcón',       70000,  7000, 8);

    const occ3Baja = new Set(['A3','B7','C5']);
    const occ3Alta = new Set(['D2','E8','F11']);
    const occ3Balc = new Set(['G5','H10']);

    for (const s of s3BajaSeats) {
      const inv = await ensureInventory(ev3.id, s.id, tt3Baja.id);
      if (occ3Baja.has(s.seat_label)) await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
    }
    for (const s of s3AltaSeats) {
      const inv = await ensureInventory(ev3.id, s.id, tt3Alta.id);
      if (occ3Alta.has(s.seat_label)) await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
    }
    for (const s of s3BalcSeats) {
      const inv = await ensureInventory(ev3.id, s.id, tt3Balc.id);
      if (occ3Balc.has(s.seat_label)) await prisma.event_seat_inventory.update({ where: { id: inv.id }, data: { status: 'SOLD' } });
    }
    console.log(`✓ THEATER 2 seed completo: ${s3BajaSeats.length + s3AltaSeats.length + s3BalcSeats.length} asientos`);
  }

  console.log('\nEventos con selección de asientos habilitada:');
  console.log(`  STADIUM → ID: ${ev1.id} | Slug: ${ev1.slug}`);
  console.log(`  THEATER → ID: ${ev2.id} | Slug: ${ev2.slug}`);
  if (ev3) console.log(`  THEATER 2 → ID: ${ev3.id} | Slug: ${ev3.slug}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
