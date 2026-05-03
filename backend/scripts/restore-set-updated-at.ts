/**
 * Restaura la función ticketing.set_updated_at a su lógica trivial
 * (solo asigna NEW.updated_at = NOW()). Fue sobrescrita por error con
 * la lógica del cart trigger, rompiendo todos los UPDATE en la base.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION ticketing.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $function$;
  `);
  console.log('set_updated_at restaurada.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
