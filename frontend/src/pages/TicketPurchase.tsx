import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getEventById, getEventTicketTypes, type EventData } from "@/data/events";
import { TicketSelector } from "@/components/ui/TicketSelector";
import { useAppContext } from "@/context/AppContext";
import { ChevronLeft, ShoppingCart } from "lucide-react";

const TicketPurchase = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToCart } = useAppContext();
  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!id) return;
    void (async () => {
      setLoading(true);
      try {
        const eventById = await getEventById(id);
        if (!eventById) {
          setEvent(null);
          return;
        }
        const ticketTypes = await getEventTicketTypes(eventById.id);
        setEvent({ ...eventById, ticketTypes });
      } catch {
        setEvent(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="min-h-screen bg-background flex flex-col"><Header /><div className="flex-1 flex items-center justify-center"><p className="text-foreground font-bold">Cargando evento...</p></div><Footer /></div>;
  if (!event) return <div className="min-h-screen bg-background flex flex-col"><Header /><div className="flex-1 flex items-center justify-center"><p className="text-foreground font-bold">Evento no encontrado</p></div><Footer /></div>;

  const updateQty = (ticketId: string, delta: number) => {
    setSelected((prev) => {
      const tt = event.ticketTypes.find((t) => t.id === ticketId);
      if (!tt) return prev;
      const cur = prev[ticketId] ?? 0;
      const next = Math.max(0, Math.min(tt.maxPerOrder, cur + delta));
      if (next === 0) { const { [ticketId]: _, ...rest } = prev; return rest; }
      return { ...prev, [ticketId]: next };
    });
  };

  const totalItems = Object.values(selected).reduce((a, b) => a + b, 0);
  const totalPrice = Object.entries(selected).reduce((s, [tid, qty]) => {
    const tt = event.ticketTypes.find((t) => t.id === tid);
    return s + (tt ? (tt.price + tt.serviceFee) * qty : 0);
  }, 0);

  const handleAdd = async () => {
    await Promise.all(Object.entries(selected).map(async ([tid, qty]) => {
      const tt = event.ticketTypes.find((t) => t.id === tid);
      if (tt && qty > 0) await addToCart({ event, ticketType: tt, quantity: qty });
    }));
    navigate("/carrito");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-primary font-bold mb-6 hover:underline"><ChevronLeft className="w-4 h-4" /> Volver al evento</button>
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <h1 className="text-2xl font-black text-foreground uppercase tracking-tight">Selecciona tus Boletos</h1>
            <TicketSelector tickets={event.ticketTypes} selected={selected} onUpdate={updateQty} />
          </div>
          <div>
            <div className="sticky top-24 bg-card rounded-xl border border-border p-6 space-y-4">
              <img src={event.image} alt={event.title} className="rounded-lg w-full aspect-video object-cover" />
              <p className="font-bold text-foreground text-sm">{event.title}</p>
              <p className="text-xs text-muted-foreground">{event.date} {event.month} {event.year} · {event.venue}</p>
              {totalItems > 0 && (
                <>
                  <hr className="border-border" />
                  {Object.entries(selected).map(([tid, qty]) => {
                    const tt = event.ticketTypes.find((t) => t.id === tid);
                    if (!tt) return null;
                    return <div key={tid} className="flex justify-between text-sm"><span className="text-muted-foreground">{tt.name} ×{qty}</span><span className="font-bold text-foreground">${(tt.price * qty).toLocaleString("es-CO")}</span></div>;
                  })}
                  <hr className="border-border" />
                  <div className="flex justify-between font-black text-foreground"><span>Total</span><span>${totalPrice.toLocaleString("es-CO")}</span></div>
                  <button onClick={handleAdd} className="w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"><ShoppingCart className="w-4 h-4" /> Agregar al Carrito</button>
                </>
              )}
              {totalItems === 0 && <p className="text-sm text-muted-foreground text-center py-4">Selecciona al menos un boleto</p>}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TicketPurchase;
