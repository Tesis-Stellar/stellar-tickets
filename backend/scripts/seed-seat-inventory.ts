/**
 * seed-seat-inventory.ts
 *
 * Convierte todos los eventos a "asientos asignados":
 *   1. Asegura que cada venue tenga 3 secciones (VIP / Platea / General)
 *      con sus seats numerados (idempotente).
 *   2. Para cada evento PUBLISHED:
 *      - Marca has_assigned_seating = true
 *      - Desactiva event_ticket_types antiguos (los GA sin venue_section_id)
 *      - Crea/asegura 3 event_ticket_types nuevos atados a las secciones
 *      - Crea event_seat_inventory (status AVAILABLE) para todos los asientos
 *
 * Idempotente: se puede correr múltiples veces sin duplicar datos.
 *
 * Uso:
 *   cd backend
 *   node --import tsx scripts/seed-seat-inventory.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SectionTemplate {
  name: 'VIP' | 'Platea' | 'General';
  code: 'VIP' | 'PLT' | 'GEN';
  rows: number;       // letras A, B, C, ...
  cols: number;       // números 1..N
  price: number;      // COP
  serviceFee: number; // COP
}

const SECTION_TEMPLATES: SectionTemplate[] = [
  { name: 'VIP',     code: 'VIP', rows: 2, cols: 10, price: 450000, serviceFee: 36000 },
  { name: 'Platea',  code: 'PLT', rows: 3, cols: 12, price: 280000, serviceFee: 22400 },
  { name: 'General', code: 'GEN', rows: 4, cols: 14, price: 120000, serviceFee:  9600 },
];

const totalSeatsPerVenue = SECTION_TEMPLATES.reduce((s, t) => s + t.rows * t.cols, 0);

async function ensureVenueSectionsAndSeats(venueId: string, venueName: string) {
  for (const tpl of SECTION_TEMPLATES) {
    // Buscar por nombre o código (cualquiera puede colisionar con datos legacy)
    let section = await prisma.venue_sections.findFirst({
      where: {
        venue_id: venueId,
        OR: [{ section_name: tpl.name }, { section_code: tpl.code }],
      },
    });
    if (section) {
      section = await prisma.venue_sections.update({
        where: { id: section.id },
        data: {
          section_name: tpl.name,
          section_code: tpl.code,
          has_numbered_seats: true,
          capacity: tpl.rows * tpl.cols,
        },
      });
    } else {
      section = await prisma.venue_sections.create({
        data: {
          venue_id: venueId,
          section_name: tpl.name,
          section_code: tpl.code,
          has_numbered_seats: true,
          capacity: tpl.rows * tpl.cols,
        },
      });
    }

    // Crear seats si no existen (uq_seats_section_label)
    const existingSeats = await prisma.seats.count({ where: { venue_section_id: section.id } });
    if (existingSeats >= tpl.rows * tpl.cols) continue;

    const rowsToCreate: { venue_section_id: string; row_label: string; seat_number: number; seat_label: string }[] = [];
    for (let r = 0; r < tpl.rows; r++) {
      const rowLabel = String.fromCharCode(65 + r); // A, B, C, ...
      for (let c = 1; c <= tpl.cols; c++) {
        rowsToCreate.push({
          venue_section_id: section.id,
          row_label: rowLabel,
          seat_number: c,
          seat_label: `${rowLabel}${c}`,
        });
      }
    }
    await prisma.seats.createMany({ data: rowsToCreate, skipDuplicates: true });
    console.log(`  [venue ${venueName}] sección ${tpl.name}: ${rowsToCreate.length} asientos creados`);
  }
}

async function seedEvent(eventId: string, eventTitle: string, venueId: string) {
  // 1. Cargar las 3 secciones del venue (debe correrse ensureVenueSectionsAndSeats antes)
  const sections = await prisma.venue_sections.findMany({
    where: { venue_id: venueId, section_code: { in: SECTION_TEMPLATES.map(t => t.code) } },
    include: { seats: { where: { is_active: true } } },
  });
  if (sections.length < 3) throw new Error(`Venue ${venueId} no tiene las 3 secciones esperadas`);

  // 2. Limpieza: cart_items y order_items + tickets que apuntan a ticket_types o seat_inventory de este evento
  //    (datos demo — se permite borrarlos)
  const oldTypes = await prisma.event_ticket_types.findMany({ where: { event_id: eventId }, select: { id: true } });
  const oldTypeIds = oldTypes.map(t => t.id);
  const oldInventory = await prisma.event_seat_inventory.findMany({ where: { event_id: eventId }, select: { id: true } });
  const oldInventoryIds = oldInventory.map(i => i.id);

  if (oldTypeIds.length > 0 || oldInventoryIds.length > 0) {
    await prisma.cart_items.deleteMany({
      where: { OR: [{ event_ticket_type_id: { in: oldTypeIds } }, { event_seat_inventory_id: { in: oldInventoryIds } }] },
    });
    if (oldInventoryIds.length > 0) {
      await prisma.seat_holds.deleteMany({ where: { event_seat_inventory_id: { in: oldInventoryIds } } });
    }
    // order_items / orders / tickets / payments: borrar (datos de demo). Encadenamos manualmente
    // porque el CHECK constraint en order_items prohíbe set FK = null.
    const orderItems = await prisma.order_items.findMany({
      where: { OR: [{ event_ticket_type_id: { in: oldTypeIds } }, { event_seat_inventory_id: { in: oldInventoryIds } }] },
      select: { id: true, order_id: true },
    });
    const orderIds = [...new Set(orderItems.map(o => o.order_id))];
    if (orderIds.length > 0) {
      // tickets referenciando estos order_items (FK)
      const orderItemIds = orderItems.map(o => o.id);
      await prisma.tickets.deleteMany({ where: { order_item_id: { in: orderItemIds } } });
      await prisma.payments.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order_items.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.orders.deleteMany({ where: { id: { in: orderIds } } });
    }
  }

  // 3. Borrar todos los event_ticket_types antiguos en una sola tx + flip flag + crear nuevos.
  //    Hay constraints contradictorios entre eventos GA y seated, así que el flip se hace
  //    cuando NO hay ticket_types (cero filas para validar).
  await prisma.$transaction([
    prisma.event_seat_inventory.deleteMany({ where: { event_id: eventId } }),
    prisma.event_ticket_types.deleteMany({ where: { event_id: eventId } }),
    prisma.events.update({ where: { id: eventId }, data: { has_assigned_seating: true } }),
  ]);

  // 4. Crear event_ticket_types nuevos atados a las secciones
  const ticketTypeBySectionId = new Map<string, string>();
  for (const section of sections) {
    const tpl = SECTION_TEMPLATES.find(t => t.code === section.section_code)!;
    const created = await prisma.event_ticket_types.create({
      data: {
        event_id: eventId,
        venue_section_id: section.id,
        ticket_type_name: tpl.name,
        price_amount: tpl.price,
        service_fee_amount: tpl.serviceFee,
        max_per_order: 6,
        inventory_quantity: null,
        is_active: true,
      },
    });
    ticketTypeBySectionId.set(section.id, created.id);
  }

  // 5. Crear event_seat_inventory rows (AVAILABLE) para todos los seats
  let inserted = 0;
  for (const section of sections) {
    const ticketTypeId = ticketTypeBySectionId.get(section.id)!;
    const inventoryRows = section.seats.map(seat => ({
      event_id: eventId,
      seat_id: seat.id,
      event_ticket_type_id: ticketTypeId,
      status: 'AVAILABLE' as const,
    }));
    if (inventoryRows.length === 0) continue;
    const result = await prisma.event_seat_inventory.createMany({
      data: inventoryRows,
      skipDuplicates: true, // unique (event_id, seat_id)
    });
    inserted += result.count;
  }
  console.log(`  [evento ${eventTitle}] inventory creado: ${inserted}/${totalSeatsPerVenue}`);
}

async function main() {
  console.log('=== Seed seat inventory ===\n');

  // Asegurar secciones+seats por venue
  const venues = await prisma.venues.findMany({ select: { id: true, name: true } });
  console.log(`Venues encontrados: ${venues.length}`);
  for (const v of venues) {
    console.log(`Procesando venue: ${v.name}`);
    await ensureVenueSectionsAndSeats(v.id, v.name);
  }

  // Sembrar inventory por evento
  const events = await prisma.events.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, title: true, venue_id: true },
  });
  console.log(`\nEventos PUBLISHED: ${events.length}`);
  for (const e of events) {
    if (!e.venue_id) {
      console.log(`  [SKIP] ${e.title}: sin venue_id`);
      continue;
    }
    await seedEvent(e.id, e.title, e.venue_id);
  }

  console.log('\n=== Listo ===');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
