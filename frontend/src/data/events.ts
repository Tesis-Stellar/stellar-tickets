const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export interface TicketType {
  id: string;
  name: string;
  price: number;
  serviceFee: number;
  available: number;
  maxPerOrder: number;
}

export interface EventData {
  id: string;
  slug: string;
  title: string;
  category: string;
  city: string;
  venue: string;
  date: string;
  month: string;
  year: string;
  time: string;
  organizer: string;
  description: string;
  recommendations: string[];
  image: string;
  bannerImage: string;
  featured: boolean;
  hasSeatSelection: boolean;
  ticketTypes: TicketType[];
  relatedEventIds: string[];
  price: string;
  liveTickets?: LiveTicket[];
  contractAddress?: string;
}

export interface LiveTicket {
  id: string;
  ticketRootId: number;
  version: number;
  sellerWallet: string;
  contractAddress: string;
}

interface EventListItemDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  categoryLabel?: string;
  city: string | null;
  organizer: string;
  bannerImage?: string;
  posterImage?: string;
  eventDate?: string;
  eventTime?: string;
  startsAt?: string;
  isFeatured?: boolean;
  hasSeatSelection?: boolean;
  hasAssignedSeating?: boolean;
  venue?: { name?: string } | string;
  minPrice?: { amount?: number; value?: number } | number;
}

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];


const toCurrency = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;

const splitDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "--", month: "---", year: "----" };
  return {
    date: String(date.getDate()).padStart(2, "0"),
    month: MONTHS[date.getMonth()],
    year: String(date.getFullYear()),
  };
};

const mapVenue = (venue: EventListItemDto["venue"]) => {
  if (typeof venue === "string") return venue;
  return venue?.name ?? "Venue por confirmar";
};

const mapMinPrice = (value: EventListItemDto["minPrice"]) => {
  if (typeof value === "number") return value;
  return value?.amount ?? value?.value ?? 0;
};

const mapEvent = (item: EventListItemDto): EventData => {
  const price = mapMinPrice(item.minPrice);
  const rawDate = item.eventDate ?? item.startsAt ?? "";
  const parsedDate = splitDate(rawDate);
  const dateObj = rawDate ? new Date(rawDate) : null;
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    category: item.categoryLabel ?? item.category,
    city: item.city ?? "Ciudad por confirmar",
    venue: mapVenue(item.venue),
    date: parsedDate.date,
    month: parsedDate.month,
    year: parsedDate.year,
    time: item.eventTime ?? (dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "--:--"),
    organizer: item.organizer,
    description: item.description,
    recommendations: [],
    image: item.posterImage || item.bannerImage || "https://placehold.co/800x500?text=Evento",
    bannerImage: item.bannerImage || item.posterImage || "https://placehold.co/1200x400?text=Evento",
    featured: item.isFeatured ?? false,
    hasSeatSelection: item.hasSeatSelection ?? item.hasAssignedSeating ?? false,
    ticketTypes: [],
    relatedEventIds: [],
    price: price > 0 ? `Desde ${toCurrency(price)}` : "Gratis",
  };
};

const apiGet = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`Error ${response.status} al consultar ${path}`);
  return response.json() as Promise<T>;
};

export const getEvents = async (filters?: {
  search?: string;
  category?: string;
  city?: string;
  sort?: string;
}): Promise<EventData[]> => {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.city) params.set("city", filters.city);
  if (filters?.sort) params.set("sort", filters.sort);
  const query = params.toString();
  const data = await apiGet<{ data: EventListItemDto[] } | EventListItemDto[]>(`/api/events${query ? `?${query}` : ""}`);
  const items = Array.isArray(data) ? data : data.data;
  return items.map(mapEvent);
};

export const getFeaturedEvents = async (): Promise<EventData[]> => {
  const data = await apiGet<EventListItemDto[]>("/api/events/featured");
  return data.map(mapEvent);
};

export const getEventBySlug = async (slug: string): Promise<EventData | null> => {
  const raw = await apiGet<EventListItemDto & { live_tickets?: LiveTicket[]; contractAddress?: string }>(`/api/events/${slug}`);
  if (!raw) return null;
  const event = mapEvent(raw);
  event.liveTickets = raw.live_tickets ?? [];
  event.contractAddress = raw.contractAddress;
  return event;
};

export const getEventById = async (id: string): Promise<EventData | null> => {
  const events = await getEvents({ search: id });
  return events.find((event) => event.id === id) ?? null;
};

export const getRelatedEvents = async (eventId: string): Promise<EventData[]> => {
  const data = await apiGet<EventListItemDto[]>(`/api/events/${eventId}/related`);
  return data.map(mapEvent);
};

export const getEventTicketTypes = async (eventId: string): Promise<TicketType[]> => {
  const data = await apiGet<
    Array<{
      id: string;
      name?: string;
      ticket_type_name?: string;
      price?: number;
      price_amount?: string;
      serviceFee?: number;
      service_fee_amount?: string;
      availability?: number;
      inventory_quantity?: number | null;
      maxPerOrder?: number;
      max_per_order?: number;
    }>
  >(
    `/api/events/${eventId}/ticket-types`
  );
  return data.map((item) => ({
    id: item.id,
    name: item.name ?? item.ticket_type_name ?? "Boleta",
    price: item.price ?? Number(item.price_amount ?? 0),
    serviceFee: item.serviceFee ?? Number(item.service_fee_amount ?? 0),
    available: item.availability ?? item.inventory_quantity ?? 0,
    maxPerOrder: item.maxPerOrder ?? item.max_per_order ?? 10,
  }));
};

export const bannerData = [
  { image: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=1200&h=400&fit=crop", title: "Shakira en Bogotá", subtitle: "15 de mayo · Estadio El Campín", cta: "Comprar Boletos", gradient: "from-primary/90 to-primary/60" },
  { image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1200&h=400&fit=crop", title: "Estéreo Picnic 2026", subtitle: "3 al 6 de abril · Parque Briceño", cta: "Comprar Abono", gradient: "from-purple-900/90 to-violet-700/60" },
  { image: "https://images.unsplash.com/photo-1489944440615-453fc2b6a9a9?w=1200&h=400&fit=crop", title: "Colombia vs Argentina", subtitle: "3 de abril · Estadio El Campín", cta: "Asegura tu entrada", gradient: "from-amber-900/90 to-yellow-700/60" },
];

export const categories = ["Conciertos", "Teatro", "Deportes", "Festivales", "Comedia", "Familiar"];
export const cities = ["Bogotá", "Medellín", "Cali", "Barranquilla", "Bucaramanga", "Cartagena", "Valledupar"];
