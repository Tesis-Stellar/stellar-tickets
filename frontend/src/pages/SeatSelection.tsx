import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SeatMap, type SectionConfig, type SelectedSeat, type VenueType } from "@/components/ui/SeatMap";
import { useAppContext } from "@/context/AppContext";
import { ChevronLeft, ShoppingCart, Loader2 } from "lucide-react";
import { getEventBySlug, getEventById, type EventData } from "@/data/events";
import { getOfficialPurchasePath, shouldRedirectPurchaseMode } from "@/lib/purchaseRoute";
import { useToast } from "@/hooks/use-toast";

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

interface SeatsApiResponse {
  venueType: VenueType;
  venueName: string;
  sections: Array<{
    id: string;
    name: string;
    ticketTypeId: string | null;
    price: number;
    serviceFee: number;
    maxPerOrder: number;
    seats: Array<{
      seatId: string;
      label: string;
      row: string;
      number: number;
      status: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";
    }>;
  }>;
}

const SeatSelection = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { addToCart, apiFetch, isLoggedIn, user } = useAppContext();
  const { toast } = useToast();
  const [event, setEvent] = useState<EventData | null>(null);
  const [seatsResponse, setSeatsResponse] = useState<SeatsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeats, setSelectedSeats] = useState<SelectedSeat[]>([]);
  const [addingToCart, setAddingToCart] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        let ev: EventData | null = null;
        try { ev = await getEventBySlug(id); } catch { /* fall through */ }
        if (!ev) ev = await getEventById(id);
        setEvent(ev);

        if (ev) {
          if (shouldRedirectPurchaseMode("seats", ev.hasSeatSelection)) {
            navigate(getOfficialPurchasePath(ev.id, ev.hasSeatSelection), { replace: true });
            return;
          }
          try {
            const data = await apiFetch<SeatsApiResponse>(`/api/events/${ev.id}/seats`);
            setSeatsResponse(data);
          } catch (e: unknown) {
            setError(getErrorMessage(e, "No fue posible cargar los asientos"));
          }
        }
      } catch {
        setEvent(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, apiFetch, navigate]);

  const toggleSeat = (seat: SelectedSeat) => {
    setSelectedSeats((prev) => {
      const exists = prev.some((s) => s.id === seat.id);
      if (exists) return prev.filter((s) => s.id !== seat.id);
      if (prev.length >= 10) return prev;
      return [...prev, seat];
    });
  };

  const total = selectedSeats.reduce((s, seat) => s + seat.price + seat.serviceFee, 0);

  const handleAdd = async () => {
    if (selectedSeats.length === 0 || !event) return;
    if (!isLoggedIn) {
      navigate("/login", {
        state: {
          from: location.pathname,
          message: "Inicia sesión para agregar asientos al carrito.",
        },
      });
      return;
    }
    if (user?.role !== "CUSTOMER") {
      navigate("/mi-cuenta");
      return;
    }
    setAddingToCart(true);
    try {
      const grouped = selectedSeats.reduce<Record<string, SelectedSeat[]>>((acc, s) => {
        (acc[s.ticketTypeId] ??= []).push(s);
        return acc;
      }, {});

      try {
        for (const [, seats] of Object.entries(grouped)) {
          const first = seats[0];
          const tt = event.ticketTypes.find((t) => t.id === first.ticketTypeId) ?? {
            id: first.ticketTypeId,
            name: first.sectionName,
            price: first.price,
            serviceFee: first.serviceFee,
            available: 100,
            maxPerOrder: 10,
          };
          await addToCart({
            event,
            ticketType: tt,
            quantity: seats.length,
            seats: seats.map((s) => s.id),
          });
        }
        navigate("/carrito");
      } catch (e: unknown) {
        // Seats may have been taken by another user between selection and add.
        toast({
          title: "No se pudieron reservar los asientos",
          description: getErrorMessage(e, "Recarga la disponibilidad y vuelve a intentar."),
          variant: "destructive",
        });
        // Refresh seat availability
        try {
          const data = await apiFetch<SeatsApiResponse>(`/api/events/${event.id}/seats`);
          setSeatsResponse(data);
          setSelectedSeats([]);
        } catch { /* ignore */ }
      }
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Cargando evento...</span>
        </div>
        <Footer />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-foreground font-bold">Evento no encontrado</p>
        </div>
        <Footer />
      </div>
    );
  }

  const sections: SectionConfig[] = (seatsResponse?.sections ?? [])
    .filter((s) => s.ticketTypeId !== null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      ticketTypeId: s.ticketTypeId as string,
      price: s.price,
      serviceFee: s.serviceFee,
      maxPerOrder: s.maxPerOrder,
      seats: s.seats,
    }));

  const venueType: VenueType = seatsResponse?.venueType ?? (event.venueType as VenueType) ?? "ARENA";
  const venueName = seatsResponse?.venueName ?? event.venue;
  const isOperationalRole = user?.role === "ADMIN" || user?.role === "STAFF";
  const seatTotals = sections.flatMap((section) => section.seats).reduce(
    (acc, seat) => {
      acc.total += 1;
      acc[seat.status.toLowerCase() as "available" | "held" | "sold" | "blocked"] += 1;
      return acc;
    },
    { total: 0, available: 0, held: 0, sold: 0, blocked: 0 }
  );
  const occupancyPercent = seatTotals.total > 0
    ? Math.round(((seatTotals.sold + seatTotals.held) / seatTotals.total) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-primary font-bold mb-6 hover:underline">
          <ChevronLeft className="w-4 h-4" /> Volver
        </button>

        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-1">{event.title}</h1>
        <p className="text-sm text-muted-foreground mb-8">
          {event.date} {event.month} {event.year} · {event.venue}, {event.city}
        </p>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 overflow-x-auto">
            <h2 className="font-black text-foreground uppercase tracking-tight mb-2">
              {isOperationalRole ? "Mapa Operativo de Asientos" : "Selecciona tus Asientos"}
            </h2>
            {isOperationalRole ? (
              <p className="text-sm text-muted-foreground mb-6">Vista solo lectura: consulta ocupación y disponibilidad sin reservar asientos.</p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive py-8 text-center">{error}</p>
            ) : (
              <SeatMap
                venueType={venueType}
                venueName={venueName}
                eventTitle={event.title}
                eventCategory={event.category}
                sections={sections}
                selectedSeats={isOperationalRole ? [] : selectedSeats}
                onToggleSeat={isOperationalRole ? () => {} : toggleSeat}
                maxSeats={10}
              />
            )}
          </div>

          <div>
            <div className="sticky top-24 bg-card rounded-xl border border-border p-6 space-y-4">
              <h3 className="font-black text-foreground uppercase tracking-tight">{isOperationalRole ? "Estado del aforo" : "Resumen"}</h3>

              {isOperationalRole ? (
                <>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Ocupación</p>
                    <p className="text-3xl font-black text-foreground">{occupancyPercent}%</p>
                    <div className="mt-3 h-2 rounded-full bg-background overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, occupancyPercent)}%` }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-bold uppercase text-muted-foreground">Disponibles</p>
                      <p className="text-xl font-black text-success">{seatTotals.available}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-bold uppercase text-muted-foreground">Vendidos</p>
                      <p className="text-xl font-black text-foreground">{seatTotals.sold}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-bold uppercase text-muted-foreground">Reservados</p>
                      <p className="text-xl font-black text-foreground">{seatTotals.held}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-bold uppercase text-muted-foreground">Bloqueados</p>
                      <p className="text-xl font-black text-foreground">{seatTotals.blocked}</p>
                    </div>
                  </div>
                  <p className="rounded-lg bg-secondary px-3 py-3 text-center text-xs font-bold text-muted-foreground">
                    Las cuentas operativas no pueden seleccionar ni reservar asientos.
                  </p>
                </>
              ) : selectedSeats.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-muted-foreground">Selecciona una sección en el mapa y luego haz clic en los asientos.</p>
                  <p className="text-xs text-muted-foreground">(Máx. 10 asientos)</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {selectedSeats.map((s) => (
                      <div key={s.id} className="flex justify-between items-start text-sm gap-2">
                        <div>
                          <span className="font-bold text-foreground block leading-tight">{s.label}</span>
                          <span className="text-[11px] text-muted-foreground">+${s.serviceFee.toLocaleString("es-CO")} serv.</span>
                        </div>
                        <span className="font-black text-foreground whitespace-nowrap">${s.price.toLocaleString("es-CO")}</span>
                      </div>
                    ))}
                  </div>

                  <hr className="border-border" />

                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal ({selectedSeats.length})</span>
                      <span>${selectedSeats.reduce((a, s) => a + s.price, 0).toLocaleString("es-CO")}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Servicio</span>
                      <span>${selectedSeats.reduce((a, s) => a + s.serviceFee, 0).toLocaleString("es-CO")}</span>
                    </div>
                    <div className="flex justify-between font-black text-foreground text-base pt-1">
                      <span>Total</span>
                      <span>${total.toLocaleString("es-CO")}</span>
                    </div>
                  </div>

                  {user?.role && user.role !== "CUSTOMER" ? (
                    <p className="rounded-lg bg-secondary px-3 py-3 text-center text-xs font-bold text-muted-foreground">Las cuentas operativas no pueden comprar boletos.</p>
                  ) : (
                    <button
                      onClick={handleAdd}
                      disabled={addingToCart}
                      className="w-full py-3 bg-accent hover:bg-accent/90 disabled:opacity-60 text-accent-foreground font-black rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"
                    >
                      {addingToCart ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                      {addingToCart ? "Agregando..." : "Agregar al Carrito"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default SeatSelection;
