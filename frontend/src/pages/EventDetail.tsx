import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getEventBySlug, getEventTicketTypes, getRelatedEvents, type EventData, type LiveTicket } from "@/data/events";
import { MapPin, Calendar, Clock, ChevronLeft, User, Info, ShieldCheck, Lock, Loader2 } from "lucide-react";
import { EventCard } from "@/components/ui/EventCard";
import { useAppContext } from "@/context/AppContext";

const EventDetail = () => {
  const { id: slug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventData | null>(null);
  const [related, setRelated] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveTickets, setLiveTickets] = useState<LiveTicket[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const { buyResaleTicket, linkWallet, walletAddress } = useAppContext();

  useEffect(() => {
    if (!slug) return;
    void (async () => {
      setLoading(true);
      try {
        const detail = await getEventBySlug(slug);
        if (!detail) {
          setEvent(null);
          setRelated([]);
          return;
        }
        const [ticketTypes, relatedEvents] = await Promise.all([getEventTicketTypes(detail.id), getRelatedEvents(detail.id)]);
        setEvent({ ...detail, ticketTypes });
        setLiveTickets(detail.liveTickets ?? []);
        setRelated(relatedEvents);
      } catch {
        setEvent(null);
        setRelated([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-foreground font-bold">Cargando evento...</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!event) return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <div className="flex-1 flex items-center justify-center flex-col gap-4">
        <h1 className="text-2xl font-black text-foreground">Evento no encontrado</h1>
        <Link to="/" className="text-primary font-bold hover:underline">← Volver al inicio</Link>
      </div>
      <Footer />
    </div>
  );

  const minPrice = event.ticketTypes.length ? Math.min(...event.ticketTypes.map((t) => t.price)) : 0;
  const buyUrl = event.hasSeatSelection ? `/evento/${event.id}/asientos` : `/evento/${event.id}/boletas`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <div className="relative h-64 md:h-96 overflow-hidden">
        <img src={event.bannerImage} alt={event.title} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/30 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 max-w-7xl mx-auto">
          <button onClick={() => navigate(-1)} className="text-primary-foreground/80 hover:text-primary-foreground flex items-center gap-1 text-sm font-bold mb-3"><ChevronLeft className="w-4 h-4" /> Volver</button>
          <span className="text-accent text-xs font-black uppercase tracking-widest">{event.category}</span>
          <h1 className="text-2xl md:text-4xl font-black text-primary-foreground mt-1">{event.title}</h1>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 md:py-12 w-full">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-card rounded-xl border border-border p-6 space-y-4">
              <h2 className="font-black text-lg text-foreground uppercase tracking-tight">Información del Evento</h2>
              <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-start gap-3"><Calendar className="w-5 h-5 text-primary mt-0.5" /><div><p className="text-sm font-bold text-foreground">{event.date} {event.month} {event.year}</p><p className="text-xs text-muted-foreground">Fecha</p></div></div>
                <div className="flex items-start gap-3"><Clock className="w-5 h-5 text-primary mt-0.5" /><div><p className="text-sm font-bold text-foreground">{event.time}</p><p className="text-xs text-muted-foreground">Hora</p></div></div>
                <div className="flex items-start gap-3"><MapPin className="w-5 h-5 text-primary mt-0.5" /><div><p className="text-sm font-bold text-foreground">{event.venue}</p><p className="text-xs text-muted-foreground">{event.city}</p></div></div>
                <div className="flex items-start gap-3"><User className="w-5 h-5 text-primary mt-0.5" /><div><p className="text-sm font-bold text-foreground">{event.organizer}</p><p className="text-xs text-muted-foreground">Organizador</p></div></div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-6 space-y-3">
              <h2 className="font-black text-lg text-foreground uppercase tracking-tight">Descripción</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{event.description}</p>
            </div>

            <div className="bg-card rounded-xl border border-border p-6 space-y-3">
              <h2 className="font-black text-lg text-foreground uppercase tracking-tight flex items-center gap-2"><Info className="w-5 h-5 text-primary" /> Recomendaciones</h2>
              <ul className="space-y-1.5">
                {event.recommendations.map((r, i) => (<li key={i} className="text-sm text-muted-foreground flex items-start gap-2"><span className="text-primary font-bold">•</span>{r}</li>))}
              </ul>
            </div>

            <div className="bg-card rounded-xl border border-border p-6 space-y-3">
              <h2 className="font-black text-lg text-foreground uppercase tracking-tight">Disponibilidad de Boletos</h2>
              <div className="space-y-2">
                {event.ticketTypes.map((tt) => (
                  <div key={tt.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div><p className="text-sm font-bold text-foreground">{tt.name}</p><p className="text-xs text-muted-foreground">{tt.available > 0 ? `${tt.available} disponibles` : "Agotado"}</p></div>
                    <span className="font-black text-primary text-sm">{tt.price > 0 ? `$${tt.price.toLocaleString("es-CO")}` : "Gratis"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-card rounded-xl border border-border p-6 space-y-5">
              <img src={event.image} alt={event.title} className="rounded-lg w-full aspect-video object-cover" />
              <p className="font-bold text-foreground text-sm">{event.title}</p>
              <p className="text-xs text-muted-foreground">{event.date} {event.month} {event.year} · {event.venue}</p>
              <p className="text-lg font-black text-primary">{minPrice > 0 ? `Desde $${minPrice.toLocaleString("es-CO")}` : "Gratis"}</p>
              <Link to={buyUrl} className="block w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg text-center text-sm transition-colors">
                Comprar Boletos Oficiales
              </Link>
            </div>

            {/* Mercado Secundario Seguro */}
            <div className="bg-purple-500/5 rounded-xl border border-purple-500/20 p-6 space-y-4 mt-6">
              <h3 className="font-black text-purple-600 uppercase tracking-tight text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Reventa P2P Segura
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Boletos revendidos por fans, custodiados y garantizados por los Contratos de Soroban.</p>

              <div className="space-y-3">
                {liveTickets.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No hay boletos en reventa para este evento.</p>
                ) : (
                  liveTickets.map((lt) => (
                    <div key={lt.id} className="bg-background rounded-lg p-3 border border-border flex justify-between items-center shadow-sm">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-foreground">Boleto #{lt.ticketRootId}</p>
                          <span className="text-[8px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Soroban</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                          Vendedor: <span className="font-mono text-foreground font-medium">{lt.sellerWallet ? `${lt.sellerWallet.slice(0, 4)}...${lt.sellerWallet.slice(-3)}` : "?"}</span>
                        </p>
                      </div>
                      <button
                        disabled={buyingId === lt.id}
                        onClick={async () => {
                          try {
                            if (!walletAddress) return alert("Conecta tu billetera Freighter desde el botón del header primero.");
                            if (walletAddress === lt.sellerWallet) return alert("No puedes comprar tu propio boleto.");
                            const pk = walletAddress;
                            setBuyingId(lt.id);
                            await linkWallet(pk).catch(() => {});
                            const buyResult = await buyResaleTicket(lt.contractAddress, lt.ticketRootId, pk);
                            if (buyResult.success) {
                              alert("Compra exitosa! Tx: " + buyResult.txHash?.slice(0, 12) + "...");
                              setLiveTickets((prev) => prev.filter((t) => t.id !== lt.id));
                            } else {
                              alert("Error: " + buyResult.error);
                            }
                          } catch (e: any) {
                            console.error("[BUY] Error:", e);
                            alert("Error: " + e.message);
                          } finally {
                            setBuyingId(null);
                          }
                        }}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-purple-900/20 disabled:opacity-50"
                      >
                        {buyingId === lt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                        {buyingId === lt.id ? "Firmando..." : "Comprar"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {related.length > 0 && (
          <div className="mt-12">
            <h2 className="font-black text-xl text-foreground uppercase tracking-tight mb-6">Eventos Relacionados</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {related.map((e) => e && <EventCard key={e.id} event={e} />)}
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default EventDetail;
