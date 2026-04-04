import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Venues and Sections in Colombia...');

  // Create default city object for Bogota
  let bogota = await prisma.cities.findFirst({ where: { city_name: 'Bogotá' } });
  if (!bogota) {
    bogota = await prisma.cities.create({
      data: { city_name: 'Bogotá', department_name: 'Bogotá D.C.', country_code: 'CO' }
    });
  }

  const venuesData = [
    {
      name: 'Movistar Arena',
      venue_type: 'ARENA',
      address_line: 'Diagonal 61c #26-36',
      sections: [
        { name: 'Platea VIP', code: 'MA-VIP', has_numbered_seats: true, capacity: 2000 },
        { name: 'Primer Piso', code: 'MA-P1', has_numbered_seats: true, capacity: 4000 },
        { name: 'Segundo Piso', code: 'MA-P2', has_numbered_seats: true, capacity: 5000 },
        { name: 'Tercer Piso', code: 'MA-P3', has_numbered_seats: true, capacity: 3000 },
      ]
    },
    {
      name: 'Estadio N. El Campín',
      venue_type: 'STADIUM',
      address_line: 'Cra. 30 #57-60',
      sections: [
        { name: 'Gramilla VIP', code: 'EC-VIP', has_numbered_seats: false, capacity: 5000 },
        { name: 'Occidental', code: 'EC-OCC', has_numbered_seats: true, capacity: 10000 },
        { name: 'Oriental', code: 'EC-ORI', has_numbered_seats: true, capacity: 15000 },
        { name: 'Norte', code: 'EC-NOR', has_numbered_seats: false, capacity: 5000 },
        { name: 'Sur', code: 'EC-SUR', has_numbered_seats: false, capacity: 4000 },
      ]
    },
    {
      name: 'Coliseo MedPlus',
      venue_type: 'COLISEUM',
      address_line: 'Calle 80 Km 1.5 Cota',
      sections: [
        { name: 'Platea', code: 'MP-PLA', has_numbered_seats: false, capacity: 4000 },
        { name: 'Gradería Baja', code: 'MP-GB', has_numbered_seats: true, capacity: 8000 },
        { name: 'Gradería Alta', code: 'MP-GA', has_numbered_seats: true, capacity: 12000 },
      ]
    }
  ];

  for (const v of venuesData) {
    let venue = await prisma.venues.findFirst({ where: { name: v.name } });
    if (!venue) {
      venue = await prisma.venues.create({
        data: {
          name: v.name,
          city_id: bogota.id,
          venue_type: v.venue_type as 'ARENA' | 'STADIUM' | 'COLISEUM',
          address_line: v.address_line,
        }
      });
      console.log(` Created Venue: ${v.name}`);
    } else {
      console.log(` Venue ${v.name} already exists.`);
    }

    for (const s of v.sections) {
      const sec = await prisma.venue_sections.findFirst({ where: { venue_id: venue.id, section_code: s.code } });
      if (!sec) {
        await prisma.venue_sections.create({
          data: {
            venue_id: venue.id,
            section_name: s.name,
            section_code: s.code,
            has_numbered_seats: s.has_numbered_seats,
            capacity: s.capacity
          }
        });
        console.log(`   Created Section: ${s.name} (${s.capacity} asientos)`);
      }
    }
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
