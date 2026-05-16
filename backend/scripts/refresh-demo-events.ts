import { PrismaClient, type event_status, type venue_type } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

type CategoryCode = 'CONCERTS' | 'THEATER' | 'SPORTS' | 'FESTIVALS' | 'COMEDY' | 'FAMILY';

const categories: Record<CategoryCode, string> = {
  CONCERTS: 'Conciertos',
  THEATER: 'Teatro',
  SPORTS: 'Deportes',
  FESTIVALS: 'Festivales',
  COMEDY: 'Comedia',
  FAMILY: 'Familiar',
};

const demoOrganizer = {
  legal_name: 'Secure Ticket Demo',
  tax_identifier: 'DEMO-SECURE-TICKET',
  support_email: 'soporte@secureticket.demo',
  support_phone: '+57 300 000 0000',
};

const demoEvents = [
  {
    slug: 'bogota-pop-night-2026',
    title: 'Bogotá Pop Night 2026',
    description: 'Evento demo de música pop para validar compra, QR y experiencia de wallet en ambiente académico.',
    category: 'CONCERTS' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Movistar Arena Demo', address_line: 'Diagonal 61C #26-36', venue_type: 'ARENA' as venue_type },
    starts_at: '2026-06-20T20:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 120000, inventory: 900 },
      { name: 'Preferencial', price: 220000, inventory: 350 },
      { name: 'VIP', price: 360000, inventory: 120 },
    ],
  },
  {
    slug: 'medellin-indie-sessions-2026',
    title: 'Medellín Indie Sessions 2026',
    description: 'Concierto demo independiente con boletería general y control antifraude por QR firmado.',
    category: 'CONCERTS' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Teatro Metropolitano Demo', address_line: 'Calle 41 #57-30', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-07-04T19:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Balcón', price: 85000, inventory: 450 },
      { name: 'Platea', price: 145000, inventory: 300 },
      { name: 'Palco', price: 260000, inventory: 80 },
    ],
  },
  {
    slug: 'caribe-live-barranquilla-2026',
    title: 'Caribe Live Barranquilla 2026',
    description: 'Festival demo caribeño con inventario amplio para validar navegación, checkout y confirmación.',
    category: 'FESTIVALS' as CategoryCode,
    city: { city_name: 'Barranquilla', department_name: 'Atlántico' },
    venue: { name: 'Centro de Eventos Caribe Demo', address_line: 'Vía 40 #79B-06', venue_type: 'COLISEUM' as venue_type },
    starts_at: '2026-07-18T18:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General Día', price: 95000, inventory: 1200 },
      { name: 'Abono Demo', price: 210000, inventory: 600 },
      { name: 'Zona Plus', price: 320000, inventory: 180 },
    ],
  },
  {
    slug: 'salsa-capital-cali-2026',
    title: 'Salsa Capital Cali 2026',
    description: 'Noche demo de salsa en vivo para ampliar la cartelera por ciudad y categoría.',
    category: 'CONCERTS' as CategoryCode,
    city: { city_name: 'Cali', department_name: 'Valle del Cauca' },
    venue: { name: 'Arena Pacífico Demo', address_line: 'Calle 5 #38-25', venue_type: 'ARENA' as venue_type },
    starts_at: '2026-08-08T20:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 70000, inventory: 1000 },
      { name: 'Preferencial', price: 135000, inventory: 400 },
      { name: 'Mesa Demo', price: 280000, inventory: 100 },
    ],
  },
  {
    slug: 'final-capital-cup-2026',
    title: 'Final Capital Cup 2026',
    description: 'Evento deportivo demo para mostrar categorías no musicales y validación de acceso.',
    category: 'SPORTS' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Estadio Capital Demo', address_line: 'Carrera 30 #57-60', venue_type: 'STADIUM' as venue_type },
    starts_at: '2026-08-30T17:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1459865264687-595d652de67e?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Norte', price: 65000, inventory: 2500 },
      { name: 'Oriental', price: 120000, inventory: 1800 },
      { name: 'Occidental', price: 180000, inventory: 900 },
    ],
  },
  {
    slug: 'standup-bogota-late-show-2026',
    title: 'Stand Up Bogotá Late Show 2026',
    description: 'Comedia demo con venta simulada y entradas verificables desde el panel de scanner.',
    category: 'COMEDY' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Teatro Norte Demo', address_line: 'Calle 95 #13-55', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-09-12T20:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 60000, inventory: 300 },
      { name: 'Preferencial', price: 95000, inventory: 160 },
    ],
  },
  {
    slug: 'teatro-moderno-medellin-2026',
    title: 'Teatro Moderno Medellín 2026',
    description: 'Obra demo para validar eventos culturales y experiencia de asientos en futuras pruebas.',
    category: 'THEATER' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Sala Cultural Medellín Demo', address_line: 'Carrera 45 #52-15', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-10-03T19:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Balcón', price: 55000, inventory: 180 },
      { name: 'Platea', price: 95000, inventory: 220 },
      { name: 'Palco', price: 155000, inventory: 60 },
    ],
  },
  {
    slug: 'festival-familiar-bogota-2026-v2',
    title: 'Festival Familiar Bogotá 2026',
    description: 'Evento demo familiar para mostrar categorías de baja fricción y checkout simulado.',
    category: 'FAMILY' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Parque Metropolitano Demo', address_line: 'Avenida Carrera 60 #63-00', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-10-18T10:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1472653431158-6364773b2a56?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Niño', price: 30000, inventory: 800 },
      { name: 'Adulto', price: 45000, inventory: 1200 },
      { name: 'Combo Familiar', price: 120000, inventory: 300 },
    ],
  },
  {
    slug: 'cartagena-summer-sessions-2026',
    title: 'Cartagena Summer Sessions 2026',
    description: 'Showcase demo de música electrónica y experiencia premium para marketplace P2P.',
    category: 'FESTIVALS' as CategoryCode,
    city: { city_name: 'Cartagena', department_name: 'Bolívar' },
    venue: { name: 'Centro Histórico Demo', address_line: 'Baluarte San Francisco Javier', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-11-14T18:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 110000, inventory: 950 },
      { name: 'Sunset Pass', price: 190000, inventory: 350 },
      { name: 'Backstage Demo', price: 390000, inventory: 80 },
    ],
  },
  {
    slug: 'bucaramanga-tech-music-2026',
    title: 'Bucaramanga Tech & Music 2026',
    description: 'Evento demo híbrido para mostrar diversidad de agenda y búsqueda por ciudad.',
    category: 'FESTIVALS' as CategoryCode,
    city: { city_name: 'Bucaramanga', department_name: 'Santander' },
    venue: { name: 'Centro de Convenciones Santander Demo', address_line: 'Carrera 27 #32-45', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-12-05T09:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 80000, inventory: 700 },
      { name: 'Full Day', price: 150000, inventory: 300 },
      { name: 'Premium Demo', price: 260000, inventory: 120 },
    ],
  },
  {
    slug: 'andes-rock-medellin-2026',
    title: 'Andes Rock Medellín 2026',
    description: 'Concierto demo de rock alternativo para enriquecer la cartelera musical.',
    category: 'CONCERTS' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Arena Antioquia Demo', address_line: 'Carrera 70 #48-30', venue_type: 'ARENA' as venue_type },
    starts_at: '2026-06-27T20:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 95000, inventory: 850 },
      { name: 'Preferencial', price: 165000, inventory: 320 },
      { name: 'VIP Demo', price: 290000, inventory: 100 },
    ],
  },
  {
    slug: 'latin-pop-cartagena-2026',
    title: 'Latin Pop Cartagena 2026',
    description: 'Show demo de pop latino con precios escalonados y experiencia de QR firmado.',
    category: 'CONCERTS' as CategoryCode,
    city: { city_name: 'Cartagena', department_name: 'Bolívar' },
    venue: { name: 'Arena Caribe Cartagena Demo', address_line: 'Avenida Santander #42-20', venue_type: 'ARENA' as venue_type },
    starts_at: '2026-09-26T20:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 105000, inventory: 1000 },
      { name: 'Platea', price: 185000, inventory: 450 },
      { name: 'Fan Zone Demo', price: 340000, inventory: 120 },
    ],
  },
  {
    slug: 'festival-cafe-pereira-2026',
    title: 'Festival Café Pereira 2026',
    description: 'Festival demo regional con agenda musical, gastronómica y familiar.',
    category: 'FESTIVALS' as CategoryCode,
    city: { city_name: 'Pereira', department_name: 'Risaralda' },
    venue: { name: 'Expo Pereira Demo', address_line: 'Avenida 30 de Agosto #87-10', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-08-15T11:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Día', price: 50000, inventory: 1200 },
      { name: 'Abono', price: 135000, inventory: 700 },
      { name: 'Experiencia Demo', price: 230000, inventory: 180 },
    ],
  },
  {
    slug: 'llanero-fest-villavicencio-2026',
    title: 'Llanero Fest Villavicencio 2026',
    description: 'Festival demo cultural para ampliar cobertura por regiones y categorías.',
    category: 'FESTIVALS' as CategoryCode,
    city: { city_name: 'Villavicencio', department_name: 'Meta' },
    venue: { name: 'Parque Las Malocas Demo', address_line: 'Kilómetro 3 Vía Catama', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-09-05T16:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 45000, inventory: 1500 },
      { name: 'Preferencial', price: 90000, inventory: 500 },
      { name: 'Zona Cultural Demo', price: 150000, inventory: 200 },
    ],
  },
  {
    slug: 'clasico-antioquia-2026',
    title: 'Clásico Antioquia 2026',
    description: 'Partido demo para validar eventos deportivos con alta demanda de inventario.',
    category: 'SPORTS' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Estadio Antioquia Demo', address_line: 'Carrera 74 #48-10', venue_type: 'STADIUM' as venue_type },
    starts_at: '2026-07-12T18:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Norte', price: 55000, inventory: 3000 },
      { name: 'Oriental', price: 95000, inventory: 2200 },
      { name: 'Occidental', price: 160000, inventory: 1000 },
    ],
  },
  {
    slug: 'basket-night-bogota-2026',
    title: 'Basket Night Bogotá 2026',
    description: 'Evento demo de baloncesto para mostrar variedad deportiva en la página.',
    category: 'SPORTS' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Coliseo Salitre Demo', address_line: 'Avenida 68 #63-10', venue_type: 'COLISEUM' as venue_type },
    starts_at: '2026-09-18T19:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 40000, inventory: 1000 },
      { name: 'Preferencial', price: 85000, inventory: 450 },
      { name: 'Cancha Demo', price: 180000, inventory: 100 },
    ],
  },
  {
    slug: 'carrera-10k-cali-2026',
    title: 'Carrera 10K Cali 2026',
    description: 'Competencia demo para probar eventos deportivos no tradicionales.',
    category: 'SPORTS' as CategoryCode,
    city: { city_name: 'Cali', department_name: 'Valle del Cauca' },
    venue: { name: 'Unidad Deportiva Cali Demo', address_line: 'Calle 9 #36-20', venue_type: 'STADIUM' as venue_type },
    starts_at: '2026-10-11T07:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Participante', price: 75000, inventory: 1800 },
      { name: 'Kit Plus', price: 120000, inventory: 700 },
      { name: 'Acompañante', price: 25000, inventory: 1000 },
    ],
  },
  {
    slug: 'tennis-open-cartagena-2026',
    title: 'Tennis Open Cartagena 2026',
    description: 'Torneo demo para diversificar el catálogo deportivo y la búsqueda por ciudad.',
    category: 'SPORTS' as CategoryCode,
    city: { city_name: 'Cartagena', department_name: 'Bolívar' },
    venue: { name: 'Club Deportivo Cartagena Demo', address_line: 'Zona Norte Km 8', venue_type: 'COLISEUM' as venue_type },
    starts_at: '2026-11-21T15:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 65000, inventory: 800 },
      { name: 'Preferencial', price: 130000, inventory: 300 },
      { name: 'Final Pass Demo', price: 240000, inventory: 100 },
    ],
  },
  {
    slug: 'monologos-del-caribe-2026',
    title: 'Monólogos del Caribe 2026',
    description: 'Comedia demo regional con formato teatral y boletería por zonas.',
    category: 'COMEDY' as CategoryCode,
    city: { city_name: 'Barranquilla', department_name: 'Atlántico' },
    venue: { name: 'Teatro Caribe Demo', address_line: 'Calle 72 #44-85', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-07-25T20:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 50000, inventory: 250 },
      { name: 'Platea', price: 85000, inventory: 160 },
      { name: 'Mesa Demo', price: 145000, inventory: 50 },
    ],
  },
  {
    slug: 'improv-night-cali-2026',
    title: 'Improv Night Cali 2026',
    description: 'Noche demo de improvisación para ampliar la categoría de comedia.',
    category: 'COMEDY' as CategoryCode,
    city: { city_name: 'Cali', department_name: 'Valle del Cauca' },
    venue: { name: 'Casa Escénica Cali Demo', address_line: 'Carrera 9 #4-50', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-08-22T20:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1574096079513-d8259312b785?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 42000, inventory: 220 },
      { name: 'Preferencial', price: 70000, inventory: 120 },
    ],
  },
  {
    slug: 'risas-en-medellin-2026',
    title: 'Risas en Medellín 2026',
    description: 'Show demo de comedia para validar más opciones de filtro y compra.',
    category: 'COMEDY' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Comedy Hall Medellín Demo', address_line: 'Calle 10 #43A-22', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-10-24T20:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 48000, inventory: 260 },
      { name: 'Platea', price: 88000, inventory: 140 },
      { name: 'Meet Demo', price: 135000, inventory: 40 },
    ],
  },
  {
    slug: 'standup-santander-2026',
    title: 'Stand Up Santander 2026',
    description: 'Comedia demo para sumar cobertura en Bucaramanga.',
    category: 'COMEDY' as CategoryCode,
    city: { city_name: 'Bucaramanga', department_name: 'Santander' },
    venue: { name: 'Teatro Santander Demo', address_line: 'Calle 36 #18-40', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-11-28T20:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 45000, inventory: 300 },
      { name: 'Preferencial', price: 75000, inventory: 150 },
    ],
  },
  {
    slug: 'hamlet-demo-bogota-2026',
    title: 'Hamlet Demo Bogotá 2026',
    description: 'Montaje teatral demo para validar eventos culturales de alta demanda.',
    category: 'THEATER' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Teatro Nacional Demo', address_line: 'Calle 71 #10-25', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-07-31T19:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1507924538820-ede94a04019d?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Balcón', price: 65000, inventory: 180 },
      { name: 'Platea', price: 115000, inventory: 250 },
      { name: 'Palco', price: 180000, inventory: 70 },
    ],
  },
  {
    slug: 'microteatro-cali-2026',
    title: 'Microteatro Cali 2026',
    description: 'Temporada demo de teatro breve para mostrar formatos culturales distintos.',
    category: 'THEATER' as CategoryCode,
    city: { city_name: 'Cali', department_name: 'Valle del Cauca' },
    venue: { name: 'Sala Experimental Cali Demo', address_line: 'Avenida 4N #10-20', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-08-29T18:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1516307365426-bea591f05011?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Función 1', price: 35000, inventory: 120 },
      { name: 'Función 2', price: 35000, inventory: 120 },
      { name: 'Abono Demo', price: 80000, inventory: 80 },
    ],
  },
  {
    slug: 'danza-contemporanea-bogota-2026',
    title: 'Danza Contemporánea Bogotá 2026',
    description: 'Función demo de danza para ampliar el catálogo escénico.',
    category: 'THEATER' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Sala Mayor Demo', address_line: 'Carrera 7 #22-40', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-09-19T19:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1508807526345-15e9b5f4eaff?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 52000, inventory: 300 },
      { name: 'Preferencial', price: 90000, inventory: 180 },
    ],
  },
  {
    slug: 'opera-de-camara-medellin-2026',
    title: 'Ópera de Cámara Medellín 2026',
    description: 'Evento demo de artes escénicas para enriquecer la categoría teatro.',
    category: 'THEATER' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Auditorio Cámara Medellín Demo', address_line: 'Calle 50 #40-20', venue_type: 'THEATER' as venue_type },
    starts_at: '2026-11-07T19:30:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Balcón', price: 75000, inventory: 160 },
      { name: 'Platea', price: 135000, inventory: 220 },
      { name: 'Palco Demo', price: 210000, inventory: 60 },
    ],
  },
  {
    slug: 'mundo-dinosaurios-bogota-2026',
    title: 'Mundo Dinosaurios Bogotá 2026',
    description: 'Experiencia demo familiar para niños y adultos con venta simulada.',
    category: 'FAMILY' as CategoryCode,
    city: { city_name: 'Bogotá', department_name: 'Bogotá D.C.' },
    venue: { name: 'Corferias Demo', address_line: 'Carrera 37 #24-67', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-07-19T10:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Niño', price: 28000, inventory: 900 },
      { name: 'Adulto', price: 42000, inventory: 900 },
      { name: 'Familia Demo', price: 115000, inventory: 250 },
    ],
  },
  {
    slug: 'aventura-espacial-medellin-2026',
    title: 'Aventura Espacial Medellín 2026',
    description: 'Evento demo inmersivo para público familiar.',
    category: 'FAMILY' as CategoryCode,
    city: { city_name: 'Medellín', department_name: 'Antioquia' },
    venue: { name: 'Planetario Demo Medellín', address_line: 'Carrera 52 #71-117', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-08-16T11:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 35000, inventory: 500 },
      { name: 'Experiencia Demo', price: 65000, inventory: 260 },
      { name: 'Familiar', price: 150000, inventory: 120 },
    ],
  },
  {
    slug: 'circo-del-rio-barranquilla-2026',
    title: 'Circo del Río Barranquilla 2026',
    description: 'Espectáculo demo familiar para ampliar ciudades y tipos de evento.',
    category: 'FAMILY' as CategoryCode,
    city: { city_name: 'Barranquilla', department_name: 'Atlántico' },
    venue: { name: 'Gran Carpa Caribe Demo', address_line: 'Malecón del Río', venue_type: 'COLISEUM' as venue_type },
    starts_at: '2026-09-27T16:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'General', price: 38000, inventory: 800 },
      { name: 'Preferencial', price: 70000, inventory: 300 },
      { name: 'Palco Familiar Demo', price: 180000, inventory: 80 },
    ],
  },
  {
    slug: 'navidad-magica-cali-2026',
    title: 'Navidad Mágica Cali 2026',
    description: 'Evento demo de temporada para cerrar la cartelera familiar del año.',
    category: 'FAMILY' as CategoryCode,
    city: { city_name: 'Cali', department_name: 'Valle del Cauca' },
    venue: { name: 'Centro Familiar Cali Demo', address_line: 'Calle 10 #50-20', venue_type: 'CONVENTION_CENTER' as venue_type },
    starts_at: '2026-12-12T17:00:00-05:00',
    cover_image_url: 'https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=1200&h=700&fit=crop',
    ticketTypes: [
      { name: 'Niño', price: 25000, inventory: 600 },
      { name: 'Adulto', price: 40000, inventory: 600 },
      { name: 'Combo Demo', price: 105000, inventory: 180 },
    ],
  },
];

const fixtureSlugPatterns = [
  /^checkout-seat-race-/,
  /^seat-race-test-/,
  /^seat-success-test-/,
  /^ga-idempotency-test-/,
  /^deploy-guard-/,
  /^imagen-demo-qa-/,
  /^ownership-fix-test-/,
];

function serviceFee(price: number) {
  return Math.round(price * 0.1);
}

async function ensureCategories() {
  for (const [code, display_name] of Object.entries(categories)) {
    await prisma.event_categories.upsert({
      where: { code },
      update: { display_name, is_active: true },
      create: { code, display_name, is_active: true },
    });
  }
}

async function ensureOrganizer() {
  return prisma.organizers.upsert({
    where: { tax_identifier: demoOrganizer.tax_identifier },
    update: demoOrganizer,
    create: demoOrganizer,
  });
}

async function ensureCity(city: { city_name: string; department_name: string }) {
  return prisma.cities.upsert({
    where: {
      country_code_department_name_city_name: {
        country_code: 'CO',
        department_name: city.department_name,
        city_name: city.city_name,
      },
    },
    update: {},
    create: { country_code: 'CO', ...city },
  });
}

async function ensureVenue(event: (typeof demoEvents)[number]) {
  const city = await ensureCity(event.city);
  const existing = await prisma.venues.findFirst({
    where: { name: event.venue.name, city_id: city.id },
  });
  if (existing) {
    return prisma.venues.update({
      where: { id: existing.id },
      data: {
        address_line: event.venue.address_line,
        venue_type: event.venue.venue_type,
        updated_at: new Date(),
      },
    });
  }
  return prisma.venues.create({
    data: {
      name: event.venue.name,
      city_id: city.id,
      address_line: event.venue.address_line,
      venue_type: event.venue.venue_type,
    },
  });
}

async function hidePastAndFixtureEvents(now: Date) {
  const past = await prisma.events.findMany({
    where: { status: 'PUBLISHED', starts_at: { lt: now } },
    select: { id: true, slug: true, title: true },
  });

  for (const event of past) {
    await prisma.events.update({
      where: { id: event.id },
      data: { status: 'COMPLETED' as event_status, updated_at: new Date() },
    });
    console.log(`COMPLETED: ${event.slug} (${event.title})`);
  }

  const published = await prisma.events.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, slug: true, title: true },
  });
  for (const event of published) {
    if (!fixtureSlugPatterns.some(pattern => pattern.test(event.slug))) continue;
    await prisma.events.update({
      where: { id: event.id },
      data: { status: 'DRAFT' as event_status, updated_at: new Date() },
    });
    console.log(`DRAFT fixture: ${event.slug} (${event.title})`);
  }
}

async function upsertDemoEvent(event: (typeof demoEvents)[number], organizerId: string) {
  const category = await prisma.event_categories.findUniqueOrThrow({ where: { code: event.category } });
  const venue = await ensureVenue(event);
  const startsAt = new Date(event.starts_at);
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000);
  const existing = await prisma.events.findUnique({ where: { slug: event.slug } });

  const saved = existing
    ? await prisma.events.update({
        where: { id: existing.id },
        data: {
          title: event.title,
          description: event.description,
          category_id: category.id,
          venue_id: venue.id,
          organizer_id: organizerId,
          cover_image_url: event.cover_image_url,
          starts_at: startsAt,
          ends_at: endsAt,
          sales_start_at: new Date(),
          sales_end_at: startsAt,
          has_assigned_seating: false,
          max_tickets_per_user: 6,
          status: 'PUBLISHED',
          updated_at: new Date(),
        },
      })
    : await prisma.events.create({
        data: {
          slug: event.slug,
          title: event.title,
          description: event.description,
          category_id: category.id,
          venue_id: venue.id,
          organizer_id: organizerId,
          cover_image_url: event.cover_image_url,
          starts_at: startsAt,
          ends_at: endsAt,
          sales_start_at: new Date(),
          sales_end_at: startsAt,
          has_assigned_seating: false,
          max_tickets_per_user: 6,
          status: 'PUBLISHED',
        },
      });

  for (const ticketType of event.ticketTypes) {
    const existingTicketType = await prisma.event_ticket_types.findFirst({
      where: { event_id: saved.id, ticket_type_name: ticketType.name },
    });

    const data = {
      venue_section_id: null,
      price_amount: ticketType.price,
      service_fee_amount: serviceFee(ticketType.price),
      inventory_quantity: ticketType.inventory,
      max_per_order: 6,
      sales_start_at: new Date(),
      sales_end_at: startsAt,
      is_active: true,
      updated_at: new Date(),
    };

    if (existingTicketType) {
      await prisma.event_ticket_types.update({ where: { id: existingTicketType.id }, data });
    } else {
      await prisma.event_ticket_types.create({
        data: {
          event_id: saved.id,
          ticket_type_name: ticketType.name,
          description: `${ticketType.name} - evento demo académico`,
          ...data,
        },
      });
    }
  }

  console.log(`PUBLISHED demo: ${event.slug} (${event.title})`);
}

async function main() {
  const now = new Date();
  await ensureCategories();
  const organizer = await ensureOrganizer();
  await hidePastAndFixtureEvents(now);

  for (const event of demoEvents) {
    await upsertDemoEvent(event, organizer.id);
  }

  console.log('\nCartelera demo actualizada. No se eliminaron eventos ni tickets.');
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
