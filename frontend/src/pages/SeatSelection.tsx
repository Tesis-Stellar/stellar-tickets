import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getEventById, getEventTicketTypes, type EventData } from "@/data/events";
import { SeatMap, type Seat } from "@/components/ui/SeatMap";
import { useAppContext } from "@/context/AppContext";
import { ChevronLeft, ShoppingCart } from "lucide-react";

const SeatSelection = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToCart } = useAppContext();
  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([]);

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

  const toggleSeat = (seat: Seat) => {
    setSelectedSeats((prev) =>
      prev.some((s) => s.id === seat.id) ? prev.filter((s) => s.id !== seat.id) : prev.length < 10 ? [...prev, seat] : prev
    );
  };

  const total = selectedSeats.reduce((s, seat) => s + seat.price + seat.serviceFee, 0);

  const handleAdd = async () => {
    if (selectedSeats.length === 0) return;
    const grouped = selectedSeats.reduce<Record<string, Seat[]>>((acc, s) => {
      (acc[s.section] ??= []).push(s);
      return acc;
    }, {});
    await Promise.all(Object.entries(grouped).map(async ([section, seats]) => {
      const tt = event.ticketTypes.find((t) => t.name === section) ?? { id: section.toLowerCase(), name: section, price: seats[0].price, serviceFee: seats[0].serviceFee, available: 100, maxPerOrder: 10 };
      await addToCart({ event, ticketType: tt, quantity: seats.length, seats: seats.map((s) => s.id) });
    }));
    navigate("/carrito");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-primary font-bold mb-6 hover:underline"><ChevronLeft className="w-4 h-4" /> Volver</button>
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-2">{event.title}</h1>
        <p className="text-sm text-muted-foreground mb-6">{event.date} {event.month} {event.year} · {event.venue}, {event.city}</p>
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 overflow-x-auto">
            <h2 className="font-black text-foreground uppercase tracking-tight mb-4">Selecciona tus Asientos</h2>
            <SeatMap eventId={event.id} selectedSeats={selectedSeats} onToggleSeat={toggleSeat} />
          </div>
          <div>
            <div className="sticky top-24 bg-card rounded-xl border border-border p-6 space-y-4">
              <h3 className="font-black text-foreground uppercase tracking-tight">Resumen</h3>
              {selectedSeats.length > 0 ? (
                <>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedSeats.map((s) => (
                      <div key={s.id} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{s.id}</span>
                        <span className="font-bold text-foreground">${s.price.toLocaleString("es-CO")}</span>
                      </div>
                    ))}
                  </div>
                  <hr className="border-border" />
                  <div className="flex justify-between font-black text-foreground"><span>Total ({selectedSeats.length})</span><span>${total.toLocaleString("es-CO")}</span></div>
                  <button onClick={handleAdd} className="w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg flex items-center justify-center gap-2 transition-colors text-sm"><ShoppingCart className="w-4 h-4" /> Agregar al Carrito</button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Selecciona asientos en el mapa<br/><span className="text-xs">(Máx. 10 asientos)</span></p>
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
