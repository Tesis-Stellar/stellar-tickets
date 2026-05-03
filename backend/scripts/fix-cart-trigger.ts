/**
 * fix-cart-trigger.ts
 *
 * Repara el trigger BEFORE INSERT en `ticketing.cart_items`. El trigger original
 * exige que `event_ticket_type_id.inventory_quantity` no sea NULL (es decir, que
 * sea GA), pero esa restricción no aplica cuando se está agregando por asiento
 * (event_seat_inventory_id NOT NULL).
 *
 * Solución: solo validar el inventory_quantity cuando NO hay seat_inventory_id
 * (es decir, sólo cuando es flujo GA).
 *
 * Uso:
 *   cd backend
 *   node --import tsx scripts/fix-cart-trigger.ts
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Buscar la función que tiene el RAISE EXCEPTION específico
  const fn = await prisma.$queryRawUnsafe<any[]>(`
    SELECT p.proname AS name, n.nspname AS schema
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'ticketing'
      AND prosrc LIKE '%cannot be added by quantity%';
  `);
  if (fn.length === 0) throw new Error('No encontré la función del trigger');
  const { name: fnName, schema } = fn[0];
  console.log(`Función a actualizar: ${schema}.${fnName}`);

  // Replace function body con la versión corregida
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ${schema}.${fnName}()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      v_inventory_quantity INTEGER;
      v_inventory_status   ticketing.seat_inventory_status;
    BEGIN
      -- Solo validar inventory_quantity cuando NO es flujo seat-based
      IF NEW.event_ticket_type_id IS NOT NULL AND NEW.event_seat_inventory_id IS NULL THEN
        SELECT ett.inventory_quantity
          INTO v_inventory_quantity
        FROM ticketing.event_ticket_types ett
        WHERE ett.id = NEW.event_ticket_type_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Event ticket type % does not exist', NEW.event_ticket_type_id;
        END IF;

        IF v_inventory_quantity IS NULL THEN
          RAISE EXCEPTION 'Ticket type % is not general-admission and cannot be added by quantity', NEW.event_ticket_type_id;
        END IF;
      END IF;

      IF NEW.event_seat_inventory_id IS NOT NULL THEN
        IF NEW.quantity <> 1 THEN
          RAISE EXCEPTION 'Seat-based cart items must have quantity = 1';
        END IF;

        SELECT esi.status
          INTO v_inventory_status
        FROM ticketing.event_seat_inventory esi
        WHERE esi.id = NEW.event_seat_inventory_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Event seat inventory % does not exist', NEW.event_seat_inventory_id;
        END IF;

        IF v_inventory_status IN ('SOLD'::ticketing.seat_inventory_status, 'BLOCKED'::ticketing.seat_inventory_status) THEN
          RAISE EXCEPTION 'Seat inventory % is not available for cart operations', NEW.event_seat_inventory_id;
        END IF;
      END IF;

      RETURN NEW;
    END;
    $function$;
  `);

  console.log('Trigger actualizado correctamente.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
