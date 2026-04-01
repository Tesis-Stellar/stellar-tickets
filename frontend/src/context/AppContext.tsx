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
}

interface AppState {
  cart: CartItem[];
  orders: OrderData[];
  purchasedTickets: PurchasedTicket[];
  user: UserData | null;
  isLoggedIn: boolean;
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
  buyResaleTicket: (contractAddress: string, ticketRootId: number, buyerPublicKey: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  linkWallet: (walletAddress: string) => Promise<void>;
  walletAddress: string | null;
  setWalletAddress: (address: string) => void;
  lastOrder: OrderData | null;
}

const AppContext = createContext<AppState | null>(null);

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

  const isLoggedIn = useMemo(() => Boolean(token && user), [token, user]);

  const apiFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Request failed: ${response.status}`);
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
    }): UserData => ({
      id: raw.id,
      name: `${raw.firstName} ${raw.lastName}`.trim(),
      firstName: raw.firstName,
      lastName: raw.lastName,
      email: raw.email,
      phone: raw.phone,
      document: raw.documentNumber,
      documentType: raw.documentType,
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
      }>("/api/users/me");
      setUser(normalizeUser(profile));
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem("authToken");
    }
  }, [apiFetch, normalizeUser]);

  useEffect(() => {
    if (!token) return;
    void refreshUserData();
  }, [refreshUserData, token]);

  useEffect(() => {
    if (!token) {
      setCart([]);
      setOrders([]);
      setPurchasedTickets([]);
      return;
    }
    void (async () => {
      try {
        const [cartData, ordersData, ticketsData] = await Promise.all([
          apiFetch<Array<{ id: string; quantity: number; seatIds?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number } }>>("/api/cart"),
          apiFetch<Array<{ id: string; orderNumber?: string; createdAt: string; total: number; subtotal?: number; serviceFees?: number; status?: string }>>("/api/orders"),
          apiFetch<Array<{ id: string; purchasedAt?: string; quantity: number; seatIds?: string[]; ticketType?: { id: string; name: string; price: number; serviceFee: number }; event?: Partial<EventData>; isSecuredOnChain?: boolean; isForSale?: boolean; contractAddress?: string; ticketRootId?: number; version?: number; ownerWallet?: string }>>("/api/tickets"),
        ]);

        setCart(
          cartData.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            seats: item.seatIds,
            ticketType: {
              id: item.ticketType?.id ?? "unknown",
              name: item.ticketType?.name ?? "Boleta",
              price: item.ticketType?.price ?? 0,
              serviceFee: item.ticketType?.serviceFee ?? 0,
              available: 0,
              maxPerOrder: 10,
            },
            event: (item as unknown as { event: EventData }).event,
          }))
        );

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

        setPurchasedTickets(
          ticketsData.map((ticket) => ({
            id: ticket.id,
            event: (ticket.event ?? {}) as EventData,
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
          }))
        );
      } catch {
        setCart([]);
        setOrders([]);
        setPurchasedTickets([]);
      }
    })();
  }, [apiFetch, token, user]);

  const addToCart = useCallback(
    async (item: Omit<CartItem, "id">) => {
      await apiFetch("/api/cart/items", {
        method: "POST",
        body: JSON.stringify({
          eventId: item.event.id,
          ticketTypeId: item.ticketType.id,
          quantity: item.quantity,
          seatIds: item.seats,
        }),
      });
      const id = `tmp-${Date.now()}`;
      setCart((prev) => [...prev, { ...item, id }]);
    },
    [apiFetch]
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
      const purchased = cart.map((c) => ({
        id: `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        event: c.event,
        ticketType: c.ticketType,
        quantity: c.quantity,
        seats: c.seats,
        purchasedAt: new Date().toISOString(),
      }));
      const order: OrderData = {
        id: orderResponse.id ?? `order-${Date.now()}`,
        orderNumber: orderResponse.orderNumber ?? `EY-${Date.now().toString().slice(-8)}`,
        items: purchased,
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
      setOrders((prev) => [order, ...prev]);
      setPurchasedTickets((prev) => [...purchased, ...prev]);
      setLastOrder(order);
      setCart([]);
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

  const secureTicketOnChain = useCallback(
    async (ticketId: string): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        const result = await apiFetch<{ success: boolean; txHash: string; contractAddress: string; ticketRootId: number }>("/api/transactions/secure-ticket", {
          method: "POST",
          body: JSON.stringify({ ticketId }),
        });
        // Update local state to reflect on-chain status
        setPurchasedTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId
              ? { ...t, isSecuredOnChain: true, contractAddress: result.contractAddress, ticketRootId: result.ticketRootId, version: 0 }
              : t
          )
        );
        return { success: true, txHash: result.txHash };
      } catch (error: any) {
        const msg = error.message || "Error asegurando ticket en blockchain";
        return { success: false, error: msg };
      }
    },
    [apiFetch]
  );

  const listTicketForSale = useCallback(
    async (ticketId: string, priceXLM: number): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        const priceStroops = Math.round(priceXLM * 10_000_000);
        const result = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/list-ticket", {
          method: "POST",
          body: JSON.stringify({ ticketId, price: priceStroops }),
        });
        setPurchasedTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, isForSale: true } : t))
        );
        return { success: true, txHash: result.txHash };
      } catch (error: any) {
        return { success: false, error: error.message || "Error listando ticket" };
      }
    },
    [apiFetch]
  );

  const buyResaleTicket = useCallback(
    async (contractAddress: string, ticketRootId: number, buyerPublicKey: string): Promise<{ success: boolean; txHash?: string; error?: string }> => {
      try {
        // 1. Get unsigned XDR from backend
        const { xdr, networkPassphrase } = await apiFetch<{ xdr: string; networkPassphrase: string }>("/api/transactions/build-buy-xdr", {
          method: "POST",
          body: JSON.stringify({ contractAddress, ticketRootId, buyerPublicKey }),
        });

        // 2. Sign with Freighter
        const { signTransaction } = await import("@stellar/freighter-api");
        const signResult = await signTransaction(xdr, { networkPassphrase });
        const signedXdr = typeof signResult === "string" ? signResult : (signResult as any)?.signedTxXdr ?? "";
        if (!signedXdr) return { success: false, error: "Firma cancelada por el usuario" };

        // 3. Submit signed XDR
        const submitResult = await apiFetch<{ success: boolean; txHash: string }>("/api/transactions/submit", {
          method: "POST",
          body: JSON.stringify({ signedXdr }),
        });
        return { success: true, txHash: submitResult.txHash };
      } catch (error: any) {
        return { success: false, error: error.message || "Error comprando ticket" };
      }
    },
    [apiFetch]
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
        user,
        isLoggedIn,
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
        buyResaleTicket,
        linkWallet,
        walletAddress,
        setWalletAddress,
        lastOrder,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
