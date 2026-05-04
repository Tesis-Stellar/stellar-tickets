import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import type { EventData, TicketType } from "@/data/events";

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
}

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
  user: UserData | null;
  isLoggedIn: boolean;
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
  secureTicketOnChain: (ticketId: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  listTicketForSale: (ticketId: string, priceXLM: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  cancelResaleListing: (ticketId: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  buyResaleTicket: (contractAddress: string, ticketRootId: number, buyerPublicKey: string, assetCode?: string | null) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  linkWallet: (walletAddress: string) => Promise<void>;
  refreshTickets: () => Promise<void>;
  walletAddress: string | null;
  setWalletAddress: (address: string | null) => void;
  lastOrder: OrderData | null;
  apiFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const AppContext = createContext<AppState | null>(null);

const normalizeEventData = (event?: Partial<EventData>): EventData =>
  ({
    ...event,
    image: (event as any)?.posterImage || (event as any)?.bannerImage || event?.image || "https://placehold.co/800x500?text=Evento",
    bannerImage: (event as any)?.bannerImage || (event as any)?.posterImage || event?.bannerImage || "https://placehold.co/1200x400?text=Evento",
  }) as EventData;

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
  const [user, setUser] = useState<UserData | null>(null);
  const [lastOrder, setLastOrder] = useState<OrderData | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("authToken"));
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
          const parsed = JSON.parse(rawMessage) as { error?: string; message?: string };
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
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem("authToken");
    }
  }, [apiFetch, normalizeUser, setWalletAddress]);

  useEffect(() => {
    if (!token) return;
    void refreshUserData();
  }, [refreshUserData, token]);

  const mapTicketsResponse = useCallback(
    (ticketsData: Array<{ id: string; purchasedAt?: string; quantity: number; seatIds?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number }; event?: Partial<EventData>; isSecuredOnChain?: boolean; isForSale?: boolean; contractAddress?: string; ticketRootId?: number; version?: number; ownerWallet?: string; resalePrice?: number | null }>): PurchasedTicket[] =>
      ticketsData.map((ticket) => ({
        id: ticket.id,
        event: normalizeEventData(ticket.event),
        ticketCode: (ticket as any)?.ticketCode,
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
      })),
    []
  );

  const refreshTickets = useCallback(async () => {
    const ticketsData = await apiFetch<Array<{ id: string; purchasedAt?: string; quantity: number; seatIds?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number }; event?: Partial<EventData>; isSecuredOnChain?: boolean; isForSale?: boolean; contractAddress?: string; ticketRootId?: number; version?: number; ownerWallet?: string; resalePrice?: number | null }>>("/api/tickets");
    setPurchasedTickets(mapTicketsResponse(ticketsData));
  }, [apiFetch, mapTicketsResponse]);

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
      return;
    }
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
        apiFetch<Array<{ id: string; orderNumber?: string; createdAt: string; total: number; subtotal?: number; serviceFees?: number; status?: string }>>("/api/orders")
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
            subtotal: order.subtotal ?? order.total,
            serviceFees: order.serviceFees ?? 0,
            total: order.total,
            createdAt: order.createdAt,
            status: order.status?.toLowerCase() === "pending" ? "pending" : "confirmed",
          }))
        );
      } else {
        setOrders([]);
      }

      const ticketsData = await load("tickets", () =>
        apiFetch<Array<{ id: string; purchasedAt?: string; quantity: number; seatIds?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number }; event?: Partial<EventData>; isSecuredOnChain?: boolean; isForSale?: boolean; contractAddress?: string; ticketRootId?: number; version?: number; ownerWallet?: string; resalePrice?: number | null }>>("/api/tickets")
      );
      if (ticketsData) {
        setPurchasedTickets(mapTicketsResponse(ticketsData));
      } else {
        setPurchasedTickets([]);
      }

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
      await apiFetch("/api/checkout/preview", {
        method: "POST",
        body: JSON.stringify({ buyerEmail: buyerInfo.email, buyerPhone: buyerInfo.phone }),
      });
      const orderResponse = await apiFetch<{ id?: string; orderNumber?: string; total?: number; subtotal?: number; serviceFees?: number }>("/api/checkout/confirm", {
        method: "POST",
        body: JSON.stringify({
          buyerEmail: buyerInfo.email,
          buyerPhone: buyerInfo.phone,
          paymentMethod: buyerInfo.paymentMethod,
        }),
      });
      const subtotal = cart.reduce((s, c) => s + c.ticketType.price * c.quantity, 0);
      const serviceFees = cart.reduce((s, c) => s + c.ticketType.serviceFee * c.quantity, 0);
      const order: OrderData = {
        id: orderResponse.id ?? `order-${Date.now()}`,
        orderNumber: orderResponse.orderNumber ?? `EY-${Date.now().toString().slice(-8)}`,
        items: [],
        buyerName: buyerInfo.name,
        buyerEmail: buyerInfo.email,
        buyerPhone: buyerInfo.phone,
        buyerDocument: buyerInfo.document,
        subtotal: orderResponse.subtotal ?? subtotal,
        serviceFees: orderResponse.serviceFees ?? serviceFees,
        total: orderResponse.total ?? subtotal + serviceFees,
        createdAt: new Date().toISOString(),
        status: "confirmed",
      };
      setLastOrder(order);
      setCart([]);

      // Refresh real tickets and orders from API to get DB UUIDs
      const ordersData = await apiFetch<Array<{ id: string; orderNumber?: string; createdAt: string; total: number; subtotal?: number; serviceFees?: number; status?: string }>>("/api/orders");
      await refreshTickets();

      setOrders(
        ordersData.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber ?? `ORD-${o.id.slice(-6).toUpperCase()}`,
          items: [],
          buyerName: user?.name ?? "",
          buyerEmail: user?.email ?? "",
          buyerPhone: user?.phone ?? "",
          buyerDocument: user?.document ?? "",
          subtotal: o.subtotal ?? o.total,
          serviceFees: o.serviceFees ?? 0,
          total: o.total,
          createdAt: o.createdAt,
          status: o.status?.toLowerCase() === "pending" ? "pending" : "confirmed",
        }))
      );

      return order;
    },
    [apiFetch, cart]
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
      return true;
    },
    [apiFetch, normalizeUser]
  );

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
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
    const connected = (connectedRes as any)?.isConnected ?? connectedRes;
    if (!connected) {
      throw new Error("Freighter no está disponible en este navegador. Instala la extensión y desbloquéala.");
    }
    const allowedRes = await api.isAllowed();
    const allowed = (allowedRes as any)?.isAllowed ?? allowedRes;
    if (!allowed) {
      const accessRes = await api.requestAccess();
      if ((accessRes as any)?.error) {
        throw new Error("Freighter rechazó la conexión. Acepta el permiso para este sitio y vuelve a intentar.");
      }
    }
    const addrRes = await api.getAddress();
    const active = (addrRes as any)?.address ?? (typeof addrRes === "string" ? addrRes : "");
    if (!active) {
      throw new Error("Freighter no devolvió una dirección. Desbloquea la extensión e intenta de nuevo.");
    }
    if (expectedAddress && active !== expectedAddress) {
      throw new Error(`La cuenta activa en Freighter (${active.slice(0, 8)}…) no coincide con la wallet vinculada a tu cuenta (${expectedAddress.slice(0, 8)}…). Cambia la cuenta activa en Freighter.`);
    }
    return active;
  }, []);

  const secureTicketOnChain = useCallback(
    async (ticketId: string): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        const result = await apiFetch<{
          success: boolean;
          txHash: string;
          contractAddress: string;
          ticketRootId: number;
          assetCode: string;
          assetIssuer: string;
          trustXdr: string | null;
          networkPassphrase: string;
        }>("/api/transactions/secure-ticket", {
          method: "POST",
          body: JSON.stringify({ ticketId }),
        });

        // 1. Reflect Soroban registration in local state immediately
        setPurchasedTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId
              ? { ...t, isSecuredOnChain: true, contractAddress: result.contractAddress, ticketRootId: result.ticketRootId, version: 0 }
              : t
          )
        );

        // 2. Issue the classic collectible to the buyer's wallet (best effort)
        if (result.trustXdr) {
          try {
            await ensureFreighterReady(walletAddress ?? undefined);
            const { signTransaction } = await import("@stellar/freighter-api");
            const signed = await signTransaction(result.trustXdr, { networkPassphrase: result.networkPassphrase });
            const signedXdr = typeof signed === "string" ? signed : (signed as any)?.signedTxXdr ?? "";
            if (signedXdr) {
              await apiFetch("/api/transactions/submit-classic", {
                method: "POST",
                body: JSON.stringify({ signedXdr }),
              });
              await apiFetch("/api/transactions/mint-collectible", {
                method: "POST",
                body: JSON.stringify({ ticketId }),
              });
              setBalanceVersion((v) => v + 1);
            }
          } catch (collectibleErr: any) {
            console.warn("[collectible] mint failed:", collectibleErr?.message);
            // Non-fatal: ticket is still secured on-chain even if the asset mint fails
          }
        }

        return { success: true, txHash: result.txHash };
      } catch (error: any) {
        const msg = error.message || "Error asegurando ticket en blockchain";
        return { success: false, error: msg };
      }
    },
    [apiFetch, ensureFreighterReady, walletAddress]
  );

  const listTicketForSale = useCallback(
    async (ticketId: string, priceXLM: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        await ensureFreighterReady(walletAddress ?? undefined);
        const priceStroops = Math.round(priceXLM * 10_000_000);
        const { xdr, networkPassphrase } = await apiFetch<{ xdr: string; networkPassphrase: string }>("/api/transactions/list-ticket", {
          method: "POST",
          body: JSON.stringify({ ticketId, price: priceStroops }),
        });
        const { signTransaction } = await import("@stellar/freighter-api");
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = typeof signResult === "string" ? signResult : (signResult as any)?.signedTxXdr ?? "";
        if (!signedXdr) return { success: false, error: "Firma cancelada por el usuario" };

        const result = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr }),
        });
        setPurchasedTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, isForSale: true, resalePrice: priceStroops } : t))
        );
        return { success: true, txHash: result.txHash };
      } catch (error: any) {
        return { success: false, error: error.message || "Error listando ticket" };
      }
    },
    [apiFetch, ensureFreighterReady, walletAddress]
  );

  const cancelResaleListing = useCallback(
    async (ticketId: string): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        await ensureFreighterReady(walletAddress ?? undefined);
        const { xdr, networkPassphrase } = await apiFetch<{ xdr: string; networkPassphrase: string }>("/api/transactions/cancel-listing", {
          method: "POST",
          body: JSON.stringify({ ticketId }),
        });
        const { signTransaction } = await import("@stellar/freighter-api");
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = typeof signResult === "string" ? signResult : (signResult as any)?.signedTxXdr ?? "";
        if (!signedXdr) return { success: false, error: "Firma cancelada por el usuario" };

        const result = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr }),
        });
        setPurchasedTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, isForSale: false, resalePrice: undefined } : t))
        );
        return { success: true, txHash: result.txHash };
      } catch (error: any) {
        return { success: false, error: error.message || "Error cancelando listado" };
      }
    },
    [apiFetch, ensureFreighterReady, walletAddress]
  );

  const buyResaleTicket = useCallback(
    async (
      contractAddress: string,
      ticketRootId: number,
      buyerPublicKey: string,
      assetCode?: string | null
    ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        await ensureFreighterReady(buyerPublicKey);
        const { signTransaction } = await import("@stellar/freighter-api");

        // 0. If the seller already issued a collectible for this ticket, the
        //    buyer must opt in via CHANGE_TRUST before receiving it.
        if (assetCode) {
          try {
            const { xdr: trustXdr, networkPassphrase: trustNet } = await apiFetch<{ xdr: string; networkPassphrase: string }>(
              "/api/transactions/build-trust-xdr",
              { method: "POST", body: JSON.stringify({ assetCode }) }
            );
            const signedTrust = await signTransaction(trustXdr, { networkPassphrase: trustNet });
            const trustSignedXdr = typeof signedTrust === "string" ? signedTrust : (signedTrust as any)?.signedTxXdr ?? "";
            if (trustSignedXdr) {
              await apiFetch("/api/transactions/submit-classic", {
                method: "POST",
                body: JSON.stringify({ signedXdr: trustSignedXdr }),
              });
            }
          } catch (trustErr: any) {
            console.warn("[collectible] trust step failed:", trustErr?.message);
            // Continue — the Soroban buy can still succeed without the collectible
          }
        }

        // 1. Get unsigned XDR for comprar_boleto
        const { xdr, networkPassphrase } = await apiFetch<{ xdr: string; networkPassphrase: string }>("/api/transactions/build-buy-xdr", {
          method: "POST",
          body: JSON.stringify({ contractAddress, ticketRootId, buyerPublicKey }),
        });

        // 2. Sign + submit the Soroban buy
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = typeof signResult === "string" ? signResult : (signResult as any)?.signedTxXdr ?? "";
        if (!signedXdr) return { success: false, error: "Firma cancelada por el usuario" };

        const submitResult = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr }),
        });

        // 3. Once the indexer has applied boleto_revendido (~7s), trigger the
        //    asset transfer (clawback from seller + payment to buyer).
        setBalanceVersion((v) => v + 1);
        void (async () => {
          await new Promise((r) => setTimeout(r, 7000));
          if (assetCode) {
            try {
              await apiFetch("/api/transactions/transfer-collectible", {
                method: "POST",
                body: JSON.stringify({ contractAddress, ticketRootId }),
              });
            } catch (e: any) {
              console.warn("[collectible] transfer failed:", e?.message);
            }
          }
          await refreshTickets().catch(() => {});
          await refreshSoldTickets().catch(() => {});
          setBalanceVersion((v) => v + 1);
        })();

        return { success: true, txHash: submitResult.txHash };
      } catch (error: any) {
        return { success: false, error: error.message || "Error comprando ticket" };
      }
    },
    [apiFetch, refreshTickets, refreshSoldTickets, ensureFreighterReady]
  );

  const linkWallet = useCallback(
    async (walletAddress: string) => {
      await apiFetch("/api/users/me/wallet", {
        method: "PATCH",
        body: JSON.stringify({ walletAddress }),
      });
    },
    [apiFetch]
  );

  return (
    <AppContext.Provider
      value={{
        cart,
        orders,
        purchasedTickets,
        soldTickets,
        user,
        isLoggedIn,
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
        listTicketForSale,
        cancelResaleListing,
        buyResaleTicket,
        linkWallet,
        refreshTickets,
        walletAddress,
        setWalletAddress,
        lastOrder,
        apiFetch,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
