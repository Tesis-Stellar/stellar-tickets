import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import type { EventData, TicketType } from "@/data/events";

const STELLAR_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/* ── Cart ── */
export interface CartItem {
  id: string;
  event: EventData;
  ticketType: TicketType;
  quantity: number;
  seats?: string[];
}

/* ── Purchased ticket ── */
export interface PurchasedTicket {
  id: string;
  ticketCode?: string;
  event: EventData;
  ticketType: TicketType;
  quantity: number;
  seats?: string[];
  purchasedAt: string;
  // Web3 fields
  isSecuredOnChain?: boolean;
  isForSale?: boolean;
  contractAddress?: string;
  ticketRootId?: number;
  version?: number;
  ownerWallet?: string;
  resalePrice?: number;
  acquiredViaResale?: boolean;
  seatLabel?: string | null;
  sectionName?: string | null;
  nftContractAddress?: string | null;
  nftTokenId?: number | null;
  qrPayload?: string | null;
}

type TransactionIntentResponse = {
  xdr: string;
  networkPassphrase: string;
  intentId: string;
  intentExpiresAt?: string;
};

export type ResaleFlowStatus = "building_xdr" | "signing" | "submitted" | "reconciling" | "confirmed" | "failed";

type ResaleFlowOptions = {
  onStatus?: (status: ResaleFlowStatus) => void;
  priceCop?: number;
};

export type ResalePolicyInfo = {
  canList: boolean;
  reason?: string | null;
  ticketStatus: string;
  isForSale: boolean;
  event?: { id: string; title: string; startsAt: string };
  ticketType?: { id: string; name: string; price: number; serviceFee: number } | null;
  policy: {
    enabled: boolean;
    limitType: "FIXED_PRICE" | "PERCENTAGE";
    originalPriceAmount: number;
    maxPriceAmount: number | null;
    maxPricePercent: number | null;
    resaleStartsAt: string | null;
    resaleEndsAt: string | null;
    resaleDeadline: string | null;
    blockHoursBeforeEvent: number;
    platformFeePercent: number;
    organizerFeePercent: number;
    sellerReceivesPercent: number;
  } | null;
};

type TicketApiResponse = {
  id: string;
  ticketCode?: string;
  purchasedAt?: string;
  quantity: number;
  seatIds?: string[];
  ticketType?: { id: string; name: string; price: number; serviceFee: number };
  event?: Partial<EventData>;
  isSecuredOnChain?: boolean;
  isForSale?: boolean;
  contractAddress?: string;
  ticketRootId?: number;
  version?: number;
  ownerWallet?: string;
  resalePrice?: number | null;
  acquiredViaResale?: boolean;
  seatLabel?: string | null;
  sectionName?: string | null;
  nftContractAddress?: string | null;
  nftTokenId?: number | null;
  qrPayload?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const hasFreighterError = (value: unknown) =>
  isRecord(value) && isRecord(value.error);
const getFreighterErrorMessage = (value: unknown, fallback: string) =>
  isRecord(value) && isRecord(value.error) && typeof value.error.message === "string"
    ? value.error.message
    : fallback;
const getFreighterAddress = (value: unknown) =>
  typeof value === "string" ? value : isRecord(value) && typeof value.address === "string" ? value.address : "";
const getFreighterFlag = (value: unknown, key: "isAllowed" | "isConnected") =>
  typeof value === "boolean" ? value : isRecord(value) && typeof value[key] === "boolean" ? value[key] : false;
const getSignedTxXdr = (value: unknown) =>
  typeof value === "string" ? value : isRecord(value) && typeof value.signedTxXdr === "string" ? value.signedTxXdr : "";
const getSignedMessagePayload = (value: unknown) => {
  if (!isRecord(value)) return { signedMessage: undefined, signerAddress: undefined };
  const signedMessage = value.signedMessage;
  const signerAddress = typeof value.signerAddress === "string" ? value.signerAddress : undefined;
  return { signedMessage, signerAddress };
};
const serializeSignedMessage = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return btoa(String.fromCharCode(...Array.from(value)));
  if (Array.isArray(value) && value.every((item): item is number => typeof item === "number")) {
    return btoa(String.fromCharCode(...value));
  }
  return "";
};

type OrderApiResponse = {
  id: string;
  orderNumber?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  buyerDocument?: string;
  createdAt?: string;
  total?: number;
  subtotal?: number;
  serviceFees?: number;
  status?: string;
  items?: TicketApiResponse[];
};

type EventApiResponse = Omit<Partial<EventData>, "city" | "venue" | "organizer"> & {
  posterImage?: string;
  bannerImage?: string;
  city?: string | { name?: unknown } | null;
  venue?: string | { name?: unknown } | null;
  organizer?: string | { name?: unknown } | null;
};

/* ── Sold ticket ── */
export interface SoldTicket {
  id: string;
  soldAt: string;
  resalePrice: number; // stroops
  contractAddress?: string;
  ticketRootId?: number;
  version?: number;
  buyerWallet?: string;
  ticketType?: { id: string; name: string; price: number };
  event?: EventData;
}

/* ── Order ── */
export interface OrderData {
  id: string;
  orderNumber: string;
  items: PurchasedTicket[];
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  buyerDocument: string;
  subtotal: number;
  serviceFees: number;
  total: number;
  createdAt: string;
  status: "confirmed" | "pending";
}

/* ── Mock user ── */
export interface UserData {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  document: string;
  documentType: "CC" | "CE" | "TI" | "PP";
  role: "CUSTOMER" | "ADMIN" | "STAFF";
}

interface AppState {
  cart: CartItem[];
  orders: OrderData[];
  purchasedTickets: PurchasedTicket[];
  soldTickets: SoldTicket[];
  ticketsLoading: boolean;
  user: UserData | null;
  isLoggedIn: boolean;
  authStatus: "checking" | "authenticated" | "unauthenticated";
  balanceVersion: number;
  addToCart: (item: Omit<CartItem, "id">) => Promise<void>;
  removeFromCart: (id: string) => Promise<void>;
  updateCartQuantity: (id: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  checkout: (buyerInfo: { name: string; email: string; phone: string; document: string; paymentMethod: "CARD" | "PSE" | "CASHPOINT" }) => Promise<OrderData | null>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (user: { name: string; email: string; phone: string; document: string; password: string }) => Promise<boolean>;
  logout: () => void;
  updateProfile: (data: Partial<UserData>) => Promise<void>;
  secureTicketOnChain: (ticketId: string) => Promise<{ success: boolean; txHash?: string; nftContractAddress?: string | null; nftTokenId?: number | null; warning?: string; error?: string }>;
  getTicketResalePolicy: (ticketId: string) => Promise<ResalePolicyInfo>;
  listTicketForSale: (ticketId: string, priceXLM: number, options?: ResaleFlowOptions) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  cancelResaleListing: (ticketId: string, options?: ResaleFlowOptions) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  buyResaleTicket: (contractAddress: string, ticketRootId: number, buyerPublicKey: string, currentVersion: number, options?: ResaleFlowOptions) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  linkWallet: (walletAddress: string) => Promise<void>;
  refreshTickets: () => Promise<void>;
  refreshSoldTickets: () => Promise<void>;
  walletAddress: string | null;
  setWalletAddress: (address: string | null) => void;
  lastOrder: OrderData | null;
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  getOrderById: (orderId: string) => Promise<OrderData>;
}

const AppContext = createContext<AppState | null>(null);

const textFromApiValue = (value: unknown, fallback: string) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) return String((value as { name?: unknown }).name ?? fallback);
  return fallback;
};

const EVENT_MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

const splitApiEventDate = (event?: EventApiResponse) => {
  const rawDate = event?.eventDate ?? event?.startsAt ?? "";
  const date = rawDate ? new Date(rawDate) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return {
      date: event?.date ?? "--",
      month: event?.month ?? "---",
      year: event?.year ?? "----",
      time: event?.time ?? "--:--",
    };
  }

  return {
    date: event?.date ?? String(date.getDate()).padStart(2, "0"),
    month: event?.month ?? EVENT_MONTHS[date.getMonth()],
    year: event?.year ?? String(date.getFullYear()),
    time: event?.time ?? date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
  };
};

const normalizeEventData = (event?: EventApiResponse): EventData => {
  const dateParts = splitApiEventDate(event);
  return ({
    ...event,
    ...dateParts,
    title: event?.title ?? "Evento por confirmar",
    category: event?.categoryLabel ?? event?.category ?? "General",
    description: event?.description ?? "",
    city: textFromApiValue(event?.city, "Ciudad por confirmar"),
    venue: textFromApiValue(event?.venue, "Venue por confirmar"),
    organizer: textFromApiValue(event?.organizer, "Organizador por confirmar"),
    image: event?.posterImage || event?.bannerImage || event?.image || "https://placehold.co/800x500?text=Evento",
    bannerImage: event?.bannerImage || event?.posterImage || "https://placehold.co/1200x400?text=Evento",
    featured: event?.featured ?? event?.isFeatured ?? false,
    hasSeatSelection: event?.hasSeatSelection ?? event?.hasAssignedSeating ?? false,
    ticketTypes: event?.ticketTypes ?? [],
    recommendations: event?.recommendations ?? [],
    relatedEventIds: event?.relatedEventIds ?? [],
    price: event?.price ?? "",
  }) as EventData;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RESALE_RECONCILE_ATTEMPTS = 6;
const RESALE_RECONCILE_DELAY_MS = 2500;

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
};

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [purchasedTickets, setPurchasedTickets] = useState<PurchasedTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);
  const [lastOrder, setLastOrder] = useState<OrderData | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("authToken"));
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "unauthenticated">(() =>
    localStorage.getItem("authToken") ? "checking" : "unauthenticated"
  );
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [soldTickets, setSoldTickets] = useState<SoldTicket[]>([]);
  const [balanceVersion, setBalanceVersion] = useState(0);

  const isLoggedIn = useMemo(() => Boolean(token && user), [token, user]);

  const apiFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
      if (!response.ok) {
        const rawMessage = await response.text();
        let message = rawMessage;
        try {
          const parsed = JSON.parse(rawMessage) as { error?: string; message?: string; code?: string; requestId?: string };
          message = parsed.error ?? parsed.message ?? rawMessage;
        } catch {
          // Keep the plain response body when it is not JSON.
        }
        throw new ApiRequestError(response.status, message || `Request failed: ${response.status}`);
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    },
    [API_BASE_URL, token]
  );

  const normalizeUser = useCallback(
    (raw: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      documentType: "CC" | "CE" | "TI" | "PP";
      documentNumber: string;
      role?: string;
    }): UserData => ({
      id: raw.id,
      name: `${raw.firstName} ${raw.lastName}`.trim(),
      firstName: raw.firstName,
      lastName: raw.lastName,
      email: raw.email,
      phone: raw.phone,
      document: raw.documentNumber,
      documentType: raw.documentType,
      role: (raw.role as "CUSTOMER" | "ADMIN" | "STAFF") || "CUSTOMER",
    }),
    []
  );

  const refreshUserData = useCallback(async () => {
    try {
      const profile = await apiFetch<{
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        documentType: "CC" | "CE" | "TI" | "PP";
        documentNumber: string;
        walletAddress?: string | null;
        role?: string;
      }>("/api/users/me");
      setUser(normalizeUser(profile));
      if (profile.walletAddress) setWalletAddress(profile.walletAddress);
      setAuthStatus("authenticated");
    } catch {
      setUser(null);
      setToken(null);
      setAuthStatus("unauthenticated");
      localStorage.removeItem("authToken");
    }
  }, [apiFetch, normalizeUser, setWalletAddress]);

  useEffect(() => {
    if (!token) {
      setAuthStatus("unauthenticated");
      return;
    }
    setAuthStatus("checking");
    void refreshUserData();
  }, [refreshUserData, token]);

  const mapTicketsResponse = useCallback(
    (ticketsData: TicketApiResponse[]): PurchasedTicket[] =>
      ticketsData.map((ticket) => ({
        id: ticket.id,
        event: normalizeEventData(ticket.event),
        ticketCode: ticket.ticketCode,
        ticketType: {
          id: ticket.ticketType?.id ?? "unknown",
          name: ticket.ticketType?.name ?? "Boleta",
          price: ticket.ticketType?.price ?? 0,
          serviceFee: ticket.ticketType?.serviceFee ?? 0,
          available: 0,
          maxPerOrder: 10,
        },
        quantity: ticket.quantity,
        seats: ticket.seatIds,
        purchasedAt: ticket.purchasedAt ?? new Date().toISOString(),
        isSecuredOnChain: ticket.isSecuredOnChain,
        isForSale: ticket.isForSale,
        contractAddress: ticket.contractAddress,
        ticketRootId: ticket.ticketRootId,
        version: ticket.version,
        ownerWallet: ticket.ownerWallet,
        resalePrice: ticket.resalePrice ?? undefined,
        acquiredViaResale: ticket.acquiredViaResale ?? false,
        seatLabel: ticket.seatLabel ?? null,
        sectionName: ticket.sectionName ?? null,
        nftContractAddress: ticket.nftContractAddress ?? null,
        nftTokenId: ticket.nftTokenId ?? null,
        qrPayload: ticket.qrPayload ?? null,
      })),
    []
  );

  const mapOrderResponse = useCallback(
    (order: OrderApiResponse, fallbackBuyer?: { name?: string; email?: string; phone?: string; document?: string }): OrderData => ({
      id: order.id,
      orderNumber: order.orderNumber ?? `ORD-${order.id.slice(-6).toUpperCase()}`,
      items: mapTicketsResponse(order.items ?? []),
      buyerName: fallbackBuyer?.name ?? user?.name ?? "",
      buyerEmail: order.buyerEmail ?? fallbackBuyer?.email ?? user?.email ?? "",
      buyerPhone: order.buyerPhone ?? fallbackBuyer?.phone ?? user?.phone ?? "",
      buyerDocument: order.buyerDocument ?? fallbackBuyer?.document ?? user?.document ?? "",
      subtotal: order.subtotal ?? order.total ?? 0,
      serviceFees: order.serviceFees ?? 0,
      total: order.total ?? 0,
      createdAt: order.createdAt ?? new Date().toISOString(),
      status: order.status?.toLowerCase() === "pending" ? "pending" : "confirmed",
    }),
    [mapTicketsResponse, user]
  );

  const getOrderById = useCallback(
    async (orderId: string) => {
      const order = await apiFetch<OrderApiResponse>(`/api/orders/${orderId}`);
      const mapped = mapOrderResponse(order);
      setLastOrder(mapped);
      return mapped;
    },
    [apiFetch, mapOrderResponse]
  );

  const fetchPurchasedTicketsSnapshot = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const ticketsData = await apiFetch<TicketApiResponse[]>("/api/tickets");
      const mapped = mapTicketsResponse(ticketsData);
      setPurchasedTickets(mapped);
      return mapped;
    } finally {
      setTicketsLoading(false);
    }
  }, [apiFetch, mapTicketsResponse]);

  const refreshTickets = useCallback(async () => {
    await fetchPurchasedTicketsSnapshot();
  }, [fetchPurchasedTicketsSnapshot]);

  const waitForTicketReconciliation = useCallback(
    async (
      predicate: (tickets: PurchasedTicket[]) => boolean,
      onStatus?: (status: ResaleFlowStatus) => void
    ) => {
      onStatus?.("reconciling");
      for (let attempt = 0; attempt < RESALE_RECONCILE_ATTEMPTS; attempt += 1) {
        await sleep(RESALE_RECONCILE_DELAY_MS);
        const snapshot = await fetchPurchasedTicketsSnapshot();
        if (predicate(snapshot)) return true;
      }
      return false;
    },
    [fetchPurchasedTicketsSnapshot]
  );

  const refreshSoldTickets = useCallback(async () => {
    const data = await apiFetch<Array<{ id: string; soldAt: string; resalePrice: number; contractAddress?: string; ticketRootId?: number; version?: number; ticketType?: { id: string; name: string; price: number }; event?: Partial<EventData> }>>("/api/tickets/sold");
    setSoldTickets(data.map((t) => ({
      ...t,
      event: t.event ? normalizeEventData(t.event) : undefined,
    })));
  }, [apiFetch]);

  useEffect(() => {
    if (!token) {
      setCart([]);
      setOrders([]);
      setPurchasedTickets([]);
      setSoldTickets([]);
      setTicketsLoading(false);
      return;
    }
    setTicketsLoading(true);
    void (async () => {
      const load = async <T,>(label: string, request: () => Promise<T>): Promise<T | null> => {
        try {
          return await request();
        } catch (error) {
          console.error(`[APP] Error cargando ${label}:`, error);
          return null;
        }
      };

      const cartData = await load("carrito", () =>
        apiFetch<Array<{ id: string; quantity: number; seatIds?: string[]; seatLabels?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number } }>>("/api/cart")
      );
      if (cartData) {
        setCart(
          cartData.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            seats: item.seatLabels ?? item.seatIds,
            ticketType: {
              id: item.ticketType?.id ?? "unknown",
              name: item.ticketType?.name ?? "Boleta",
              price: item.ticketType?.price ?? 0,
              serviceFee: item.ticketType?.serviceFee ?? 0,
              available: 0,
              maxPerOrder: 10,
            },
            event: normalizeEventData((item as unknown as { event?: Partial<EventData> }).event),
          }))
        );
      } else {
        setCart([]);
      }

      const ordersData = await load("órdenes", () =>
        apiFetch<OrderApiResponse[]>("/api/orders")
      );
      if (ordersData) {
        setOrders(
          ordersData.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber ?? `ORD-${order.id.slice(-6).toUpperCase()}`,
            items: [],
            buyerName: user?.name ?? "",
            buyerEmail: user?.email ?? "",
            buyerPhone: user?.phone ?? "",
            buyerDocument: user?.document ?? "",
            subtotal: order.subtotal ?? order.total ?? 0,
            serviceFees: order.serviceFees ?? 0,
            total: order.total ?? 0,
            createdAt: order.createdAt ?? new Date().toISOString(),
            status: order.status?.toLowerCase() === "pending" ? "pending" : "confirmed",
          }))
        );
      } else {
        setOrders([]);
      }

      const ticketsData = await load("tickets", () =>
        apiFetch<TicketApiResponse[]>("/api/tickets")
      );
      if (ticketsData) {
        setPurchasedTickets(mapTicketsResponse(ticketsData));
      } else {
        setPurchasedTickets([]);
      }
      setTicketsLoading(false);

      const soldData = await load("ventas", () =>
        apiFetch<Array<{ id: string; soldAt: string; resalePrice: number; contractAddress?: string; ticketRootId?: number; version?: number; ticketType?: { id: string; name: string; price: number }; event?: Partial<EventData> }>>("/api/tickets/sold")
      );
      if (soldData) {
        setSoldTickets(soldData.map((t) => ({
          ...t,
          event: t.event ? normalizeEventData(t.event) : undefined,
        })));
      } else {
        setSoldTickets([]);
      }
    })();
  }, [apiFetch, token, user, mapTicketsResponse]);

  const refreshCart = useCallback(async () => {
    const cartData = await apiFetch<Array<{ id: string; quantity: number; seatIds?: string[]; seatLabels?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number }; event?: Partial<EventData> }>>("/api/cart");
    setCart(
      cartData.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        seats: item.seatLabels ?? item.seatIds,
        ticketType: {
          id: item.ticketType?.id ?? "unknown",
          name: item.ticketType?.name ?? "Boleta",
          price: item.ticketType?.price ?? 0,
          serviceFee: item.ticketType?.serviceFee ?? 0,
          available: 0,
          maxPerOrder: 10,
        },
        event: normalizeEventData(item.event),
      }))
    );
  }, [apiFetch]);

  const addToCart = useCallback(
    async (item: Omit<CartItem, "id">) => {
      // For seated tickets, item.seats holds seat UUIDs (from SeatSelection).
      // For GA tickets, item.seats is undefined; only quantity matters.
      const seatIds = item.seats;
      const isSeated = Array.isArray(seatIds) && seatIds.length > 0;
      await apiFetch<{ id: string }>("/api/cart/items", {
        method: "POST",
        body: JSON.stringify({
          eventId: item.event.id,
          ticketTypeId: item.ticketType.id,
          quantity: isSeated ? undefined : item.quantity,
          seatIds: isSeated ? seatIds : undefined,
        }),
      });
      // Re-fetch cart so seated tickets show real labels and per-seat rows
      // (backend creates one cart_item per seat for assigned seating).
      await refreshCart();
    },
    [apiFetch, refreshCart]
  );

  const removeFromCart = useCallback(
    async (id: string) => {
      await apiFetch(`/api/cart/items/${id}`, { method: "DELETE" });
      setCart((prev) => prev.filter((c) => c.id !== id));
    },
    [apiFetch]
  );

  const updateCartQuantity = useCallback(
    async (id: string, quantity: number) => {
      if (quantity <= 0) {
        await removeFromCart(id);
        return;
      }
      await apiFetch(`/api/cart/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
      setCart((prev) => prev.map((c) => (c.id === id ? { ...c, quantity } : c)));
    },
    [apiFetch, removeFromCart]
  );

  const clearCart = useCallback(async () => {
    await apiFetch("/api/cart/clear", { method: "DELETE" });
    setCart([]);
  }, [apiFetch]);

  const checkout = useCallback(
    async (buyerInfo: { name: string; email: string; phone: string; document: string; paymentMethod: "CARD" | "PSE" | "CASHPOINT" }): Promise<OrderData | null> => {
      const idempotencyKey = `checkout:${cart
        .map((item) => `${item.id}:${item.quantity}`)
        .sort()
        .join("|")}`;
      await apiFetch("/api/checkout/preview", {
        method: "POST",
        body: JSON.stringify({ buyerEmail: buyerInfo.email, buyerPhone: buyerInfo.phone }),
      });
      const orderResponse = await apiFetch<OrderApiResponse & { paymentMode?: "SIMULATED"; idempotentReplay?: boolean }>("/api/checkout/confirm", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          buyerEmail: buyerInfo.email,
          buyerPhone: buyerInfo.phone,
          paymentMethod: buyerInfo.paymentMethod,
          idempotencyKey,
        }),
      });
      const order = mapOrderResponse(orderResponse, buyerInfo);
      setLastOrder(order);
      setCart([]);

      // Refresh real tickets and orders from API to get DB UUIDs
      const ordersData = await apiFetch<OrderApiResponse[]>("/api/orders");
      await refreshTickets();

      setOrders(ordersData.map((o) => mapOrderResponse(o)));

      return order;
    },
    [apiFetch, cart, mapOrderResponse, refreshTickets]
  );

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const response = await apiFetch<{
        accessToken: string;
        user: {
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          phone: string;
          documentType: "CC" | "CE" | "TI" | "PP";
          documentNumber: string;
        };
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(response.accessToken);
      localStorage.setItem("authToken", response.accessToken);
      setUser(normalizeUser(response.user));
      setAuthStatus("authenticated");
      return true;
    },
    [apiFetch, normalizeUser]
  );

  const register = useCallback(
    async (data: { name: string; email: string; phone: string; document: string; password: string }): Promise<boolean> => {
      const [firstName, ...rest] = data.name.trim().split(" ");
      const lastName = rest.join(" ") || "-";
      const response = await apiFetch<{
        accessToken: string;
        user: {
          id: string;
          firstName: string;
          lastName: string;
          email: string;
          phone: string;
          documentType: "CC" | "CE" | "TI" | "PP";
          documentNumber: string;
        };
      }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          email: data.email,
          documentType: "CC",
          documentNumber: data.document,
          phone: data.phone,
          password: data.password,
        }),
      });
      setToken(response.accessToken);
      localStorage.setItem("authToken", response.accessToken);
      setUser(normalizeUser(response.user));
      setAuthStatus("authenticated");
      return true;
    },
    [apiFetch, normalizeUser]
  );

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setAuthStatus("unauthenticated");
    setCart([]);
    setOrders([]);
    setPurchasedTickets([]);
    localStorage.removeItem("authToken");
  }, []);

  const updateProfile = useCallback(
    async (data: Partial<UserData>) => {
      if (!user) return;
      const [firstName, ...rest] = (data.name ?? user.name).trim().split(" ");
      const lastName = rest.join(" ") || user.lastName || "-";
      const response = await apiFetch<{
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        documentType: "CC" | "CE" | "TI" | "PP";
        documentNumber: string;
      }>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          firstName,
          lastName,
          phone: data.phone ?? user.phone,
          documentType: data.documentType ?? user.documentType,
          documentNumber: data.document ?? user.document,
        }),
      });
      setUser(normalizeUser(response));
    },
    [apiFetch, normalizeUser, user]
  );

  // Ensures Freighter is connected/authorized on this browser session and that
  // the active account matches the wallet linked to the user. Throws a helpful
  // error if the user denies, has a different account active, or has no extension.
  const ensureFreighterReady = useCallback(async (expectedAddress?: string): Promise<string> => {
    const api = await import("@stellar/freighter-api");
    const connectedRes = await api.isConnected();
    const connected = getFreighterFlag(connectedRes, "isConnected");
    if (!connected) {
      throw new Error("Freighter no está disponible en este navegador. Instala la extensión y desbloquéala.");
    }
    const allowedRes = await api.isAllowed();
    const allowed = getFreighterFlag(allowedRes, "isAllowed");
    let accessAddress = "";
    if (!allowed) {
      const accessRes = await api.requestAccess();
      if (hasFreighterError(accessRes)) {
        throw new Error("Freighter rechazó la conexión. Acepta el permiso para este sitio y vuelve a intentar.");
      }
      accessAddress = getFreighterAddress(accessRes);
    }
    let active = accessAddress;
    try {
      const addrRes = await api.getAddress();
      active = getFreighterAddress(addrRes) || active;
    } catch {
      // requestAccess already gives us the selected address on supported Freighter versions.
    }
    if (!active) {
      const accessRes = await api.requestAccess();
      if (hasFreighterError(accessRes)) {
        throw new Error("Freighter rechazó la conexión. Acepta el permiso para este sitio y vuelve a intentar.");
      }
      active = getFreighterAddress(accessRes);
    }
    if (!active) {
      throw new Error("Freighter no pudo confirmar la cuenta activa. Abre la extensión, desbloquéala y vuelve a intentar.");
    }
    if (expectedAddress && active !== expectedAddress) {
      throw new Error(`La cuenta activa en Freighter (${active.slice(0, 8)}…) no coincide con la wallet vinculada a tu cuenta (${expectedAddress.slice(0, 8)}…). Cambia la cuenta activa en Freighter.`);
    }
    return active;
  }, []);

  const secureTicketOnChain = useCallback(
    async (ticketId: string): Promise<{ success: boolean; txHash?: string; nftContractAddress?: string | null; nftTokenId?: number | null; warning?: string; error?: string }> => {
      try {
        const result = await apiFetch<{
          success: boolean;
          txHash: string;
          contractAddress: string;
          ticketRootId: number;
          nftContractAddress: string | null;
          nftTokenId: number | null;
          nftMintTxHash: string | null;
          networkPassphrase: string;
        }>("/api/transactions/secure-ticket", {
          method: "POST",
          body: JSON.stringify({ ticketId }),
        });

        // El mint del NFT (Soroban) se hace server-side; el frontend solo
        // refleja el estado y notifica al usuario qué contrato añadir a Freighter.
        setPurchasedTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId
              ? {
                  ...t,
                  isSecuredOnChain: true,
                  contractAddress: result.contractAddress,
                  ticketRootId: result.ticketRootId,
                  version: 0,
                  nftContractAddress: result.nftContractAddress ?? null,
                  nftTokenId: result.nftTokenId ?? null,
                }
              : t
          )
        );
        setBalanceVersion((v) => v + 1);

        return {
          success: true,
          txHash: result.txHash,
          nftContractAddress: result.nftContractAddress,
          nftTokenId: result.nftTokenId ?? null,
          warning: result.nftContractAddress && result.nftTokenId == null
            ? "La boleta quedó asegurada en blockchain, pero el NFT coleccionable no se pudo mintear todavía."
            : undefined,
        };
      } catch (error: unknown) {
        const msg = getErrorMessage(error, "Error asegurando ticket en blockchain");
        return { success: false, error: msg };
      }
    },
    [apiFetch]
  );

  const listTicketForSale = useCallback(
    async (ticketId: string, priceXLM: number, options?: ResaleFlowOptions): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        await ensureFreighterReady(walletAddress ?? undefined);
        const priceStroops = Math.round(priceXLM * 10_000_000);
        options?.onStatus?.("building_xdr");
        const { xdr, networkPassphrase, intentId } = await apiFetch<TransactionIntentResponse>("/api/transactions/list-ticket", {
          method: "POST",
          body: JSON.stringify({ ticketId, price: priceStroops, priceCop: options?.priceCop }),
        });
        options?.onStatus?.("signing");
        const { signTransaction } = await import("@stellar/freighter-api");
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = getSignedTxXdr(signResult);
        if (!signedXdr) {
          options?.onStatus?.("failed");
          return { success: false, error: "Firma cancelada por el usuario" };
        }

        const result = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr, intentId }),
        });
        options?.onStatus?.("submitted");
        const confirmed = await waitForTicketReconciliation(
          (tickets) => tickets.some((t) => t.id === ticketId && t.isForSale === true && t.resalePrice === priceStroops),
          options?.onStatus
        );
        if (!confirmed) {
          options?.onStatus?.("failed");
          return { success: false, txHash: result.txHash, error: "Transaccion enviada, pero el indexer aun no confirma el listado." };
        }
        setBalanceVersion((v) => v + 1);
        options?.onStatus?.("confirmed");
        return { success: true, txHash: result.txHash };
      } catch (error: unknown) {
        options?.onStatus?.("failed");
        return { success: false, error: getErrorMessage(error, "Error listando ticket") };
      }
    },
    [apiFetch, ensureFreighterReady, waitForTicketReconciliation, walletAddress]
  );

  const getTicketResalePolicy = useCallback(
    async (ticketId: string): Promise<ResalePolicyInfo> => {
      return apiFetch<ResalePolicyInfo>(`/api/tickets/${ticketId}/resale-policy`);
    },
    [apiFetch]
  );

  const cancelResaleListing = useCallback(
    async (ticketId: string, options?: ResaleFlowOptions): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        await ensureFreighterReady(walletAddress ?? undefined);
        options?.onStatus?.("building_xdr");
        const { xdr, networkPassphrase, intentId } = await apiFetch<TransactionIntentResponse>("/api/transactions/cancel-listing", {
          method: "POST",
          body: JSON.stringify({ ticketId }),
        });
        options?.onStatus?.("signing");
        const { signTransaction } = await import("@stellar/freighter-api");
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = getSignedTxXdr(signResult);
        if (!signedXdr) {
          options?.onStatus?.("failed");
          return { success: false, error: "Firma cancelada por el usuario" };
        }

        const result = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr, intentId }),
        });
        options?.onStatus?.("submitted");
        const confirmed = await waitForTicketReconciliation(
          (tickets) => tickets.some((t) => t.id === ticketId && t.isForSale !== true),
          options?.onStatus
        );
        if (!confirmed) {
          options?.onStatus?.("failed");
          return { success: false, txHash: result.txHash, error: "Transaccion enviada, pero el indexer aun no confirma la cancelacion." };
        }
        setBalanceVersion((v) => v + 1);
        options?.onStatus?.("confirmed");
        return { success: true, txHash: result.txHash };
      } catch (error: unknown) {
        options?.onStatus?.("failed");
        return { success: false, error: getErrorMessage(error, "Error cancelando listado") };
      }
    },
    [apiFetch, ensureFreighterReady, waitForTicketReconciliation, walletAddress]
  );

  const buyResaleTicket = useCallback(
    async (
      contractAddress: string,
      ticketRootId: number,
      buyerPublicKey: string,
      currentVersion: number,
      options?: ResaleFlowOptions
    ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        await ensureFreighterReady(buyerPublicKey);
        const { signTransaction } = await import("@stellar/freighter-api");

        // 1. XDR sin firmar para comprar_boleto
        options?.onStatus?.("building_xdr");
        const { xdr, networkPassphrase, intentId } = await apiFetch<TransactionIntentResponse>("/api/transactions/build-buy-xdr", {
          method: "POST",
          body: JSON.stringify({ contractAddress, ticketRootId, buyerPublicKey }),
        });

        // 2. Firma + submit del comprar_boleto
        options?.onStatus?.("signing");
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = getSignedTxXdr(signResult);
        if (!signedXdr) {
          options?.onStatus?.("failed");
          return { success: false, error: "Firma cancelada por el usuario" };
        }

        const submitResult = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr, intentId }),
        });
        options?.onStatus?.("submitted");

        // 3. Tras ~7s (indexer aplica boleto_revendido), pedir la transferencia
        //    del collectible NFT solo si el backend puede verificar txHash/comprador/version.
        options?.onStatus?.("reconciling");
        setBalanceVersion((v) => v + 1);
        await sleep(7000);
        try {
          await apiFetch("/api/transactions/transfer-nft", {
            method: "POST",
            body: JSON.stringify({
              contractAddress,
              ticketRootId,
              buyerWallet: buyerPublicKey,
              txHash: submitResult.txHash,
              expectedVersion: currentVersion + 1,
            }),
          });
        } catch (e: unknown) {
          console.warn("[nft] verified transfer skipped:", getErrorMessage(e, "transfer failed"));
        }
        const confirmed = await waitForTicketReconciliation(
          (tickets) =>
            tickets.some((t) =>
              t.contractAddress === contractAddress &&
              t.ticketRootId === ticketRootId &&
              t.version === currentVersion + 1
            ),
          options?.onStatus
        );
        await refreshSoldTickets().catch(() => {});
        setBalanceVersion((v) => v + 1);
        if (!confirmed) {
          options?.onStatus?.("failed");
          return { success: false, txHash: submitResult.txHash, error: "Transaccion enviada, pero el indexer aun no confirma la compra." };
        }

        options?.onStatus?.("confirmed");
        return { success: true, txHash: submitResult.txHash };
      } catch (error: unknown) {
        options?.onStatus?.("failed");
        return { success: false, error: getErrorMessage(error, "Error comprando ticket") };
      }
    },
    [apiFetch, refreshSoldTickets, ensureFreighterReady, waitForTicketReconciliation]
  );

  const linkWallet = useCallback(
    async (walletAddress: string) => {
      const challenge = await apiFetch<{
        challengeId: string;
        message: string;
        expiresAt: string;
      }>("/api/wallet/challenge", {
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      });

      const { signMessage } = await import("@stellar/freighter-api");
      const signed = await signMessage(challenge.message, {
        networkPassphrase: STELLAR_TESTNET_PASSPHRASE,
        address: walletAddress,
      });
      if (hasFreighterError(signed)) {
        throw new Error(getFreighterErrorMessage(signed, "Freighter no pudo firmar el challenge de wallet"));
      }

      const { signedMessage, signerAddress } = getSignedMessagePayload(signed);
      if (signerAddress && signerAddress !== walletAddress) {
        throw new Error("La firma no corresponde a la wallet seleccionada en Freighter");
      }

      const signature = serializeSignedMessage(signedMessage);

      await apiFetch("/api/users/me/wallet", {
        method: "PATCH",
        body: JSON.stringify({
          walletAddress,
          challengeId: challenge.challengeId,
          signature,
        }),
      });
      setWalletAddress(walletAddress);
    },
    [apiFetch, setWalletAddress]
  );

  return (
    <AppContext.Provider
      value={{
        cart,
        orders,
        purchasedTickets,
        soldTickets,
        ticketsLoading,
        user,
        isLoggedIn,
        authStatus,
        balanceVersion,
        addToCart,
        removeFromCart,
        updateCartQuantity,
        clearCart,
        checkout,
        login,
        register,
        logout,
        updateProfile,
        secureTicketOnChain,
        getTicketResalePolicy,
        listTicketForSale,
        cancelResaleListing,
        buyResaleTicket,
        linkWallet,
        refreshTickets,
        refreshSoldTickets,
        walletAddress,
        setWalletAddress,
        lastOrder,
        apiFetch,
        getOrderById,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
