import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getEventBySlug, getEventTicketTypes, getRelatedEvents, type EventData, type LiveTicket } from "@/data/events";
import { MapPin, Calendar, Clock, ChevronLeft, User, Info, ShieldCheck, Lock, Loader2, ExternalLink, CheckCircle2, BarChart3, QrCode, TicketCheck, Activity } from "lucide-react";
import { EventCard } from "@/components/ui/EventCard";
import { useAppContext, type ResaleFlowStatus } from "@/context/AppContext";
import { useXlmPrice, formatCOP } from "@/hooks/useXlmPrice";
import { getOfficialPurchasePath } from "@/lib/purchaseRoute";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type OperationalSeatsResponse = {
  sections: Array<{
    id: string;
    name: string;
    seats: Array<{ status: "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED" }>;
  }>;
};

const EventDetail = () => {
  const { id: slug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventData | null>(null);
  const [related, setRelated] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveTickets, setLiveTickets] = useState<LiveTicket[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [flowStatusByTicketId, setFlowStatusByTicketId] = useState<Record<string, ResaleFlowStatus>>({});
  const [successDialog, setSuccessDialog] = useState<{ kind: "buy" | "cancel"; txHash?: string } | null>(null);
  const [operationalSeats, setOperationalSeats] = useState<OperationalSeatsResponse | null>(null);
  const { buyResaleTicket, cancelResaleListing, linkWallet, walletAddress, apiFetch, user } = useAppContext();
  const { toast } = useToast();
  const xlmCop = useXlmPrice();

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
        // Only fetch ticket types if not already included in detail response
        const [ticketTypes, relatedEvents] = await Promise.all([
          detail.ticketTypes.length ? Promise.resolve(detail.ticketTypes) : getEventTicketTypes(detail.id),
          getRelatedEvents(detail.id),
        ]);
        const nextEvent = { ...detail, ticketTypes };
        setEvent(nextEvent);
        setLiveTickets(detail.liveTickets ?? []);
        setRelated(relatedEvents);
        if (["ADMIN", "STAFF"].includes(user?.role ?? "") && nextEvent.hasSeatSelection) {
          try {
            const seats = await apiFetch<OperationalSeatsResponse>(`/api/events/${nextEvent.id}/seats`);
            setOperationalSeats(seats);
          } catch {
            setOperationalSeats(null);
          }
        } else {
          setOperationalSeats(null);
        }
      } catch {
        setEvent(null);
        setRelated([]);
        setOperationalSeats(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, apiFetch, user?.role]);

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
  const buyUrl = getOfficialPurchasePath(event.id, event.hasSeatSelection);
  const isOperationalRole = user?.role === "ADMIN" || user?.role === "STAFF";
  const seatTotals = operationalSeats
    ? operationalSeats.sections.flatMap((section) => section.seats).reduce(
        (acc, seat) => {
          acc.total += 1;
          acc[seat.status.toLowerCase() as "available" | "held" | "sold" | "blocked"] += 1;
          return acc;
        },
        { total: 0, available: 0, held: 0, sold: 0, blocked: 0 }
      )
    : null;
  const ticketAvailable = event.ticketTypes.reduce((sum, tt) => sum + Math.max(0, tt.available), 0);
  const operationalTotal = seatTotals?.total ?? ticketAvailable;
  const operationalAvailable = seatTotals?.available ?? ticketAvailable;
  const operationalSold = seatTotals?.sold ?? 0;
  const operationalHeld = seatTotals?.held ?? 0;
  const operationalBlocked = seatTotals?.blocked ?? 0;
  const occupancyPercent = operationalTotal > 0
    ? Math.round(((operationalSold + operationalHeld) / operationalTotal) * 100)
    : 0;
  const flowStatusLabel: Record<ResaleFlowStatus, string> = {
    building_xdr: "Preparando XDR...",
    signing: "Esperando firma...",
    submitted: "Enviada...",
    reconciling: "Confirmando...",
    confirmed: "Confirmado",
    failed: "Falló",
  };
  const setTicketFlowStatus = (ticketId: string, status: ResaleFlowStatus) => {
    setFlowStatusByTicketId((prev) => ({ ...prev, [ticketId]: status }));
  };

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
            {isOperationalRole ? (
              <div className="bg-card rounded-xl border border-border p-6 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-primary">Secure Ticket Console</p>
                    <h3 className="font-black text-foreground uppercase tracking-tight mt-1">Estado del evento</h3>
                  </div>
                  <Activity className="w-8 h-8 text-primary" />
                </div>

                <div className="rounded-xl bg-secondary p-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-bold uppercase tracking-wider">Ocupación</p>
                      <p className="text-3xl font-black text-foreground">{occupancyPercent}%</p>
                    </div>
                    <BarChart3 className="w-8 h-8 text-primary" />
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-background overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, occupancyPercent)}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-muted-foreground text-xs font-bold uppercase">Disponibles</p>
                    <p className="text-xl font-black text-success">{operationalAvailable}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-muted-foreground text-xs font-bold uppercase">Vendidos</p>
                    <p className="text-xl font-black text-foreground">{operationalSold}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-muted-foreground text-xs font-bold uppercase">Reservados</p>
                    <p className="text-xl font-black text-foreground">{operationalHeld}</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-muted-foreground text-xs font-bold uppercase">Bloqueados</p>
                    <p className="text-xl font-black text-foreground">{operationalBlocked}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {event.hasSeatSelection ? (
                    <Link to={buyUrl} className="flex items-center justify-center gap-2 w-full py-3 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-black rounded-lg text-center text-sm transition-colors">
                      <TicketCheck className="w-4 h-4" /> Ver mapa de asientos
                    </Link>
                  ) : null}
                  <Link to="/escanear" className="flex items-center justify-center gap-2 w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-black rounded-lg text-center text-sm transition-colors">
                    <QrCode className="w-4 h-4" /> Abrir escáner
                  </Link>
                  {user?.role === "ADMIN" ? (
                    <Link to="/mi-cuenta" className="flex items-center justify-center gap-2 w-full py-3 border border-border hover:bg-secondary text-foreground font-black rounded-lg text-center text-sm transition-colors">
                      Secure Ticket Console
                    </Link>
                  ) : null}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Las cuentas operativas no compran boletos. Secure Ticket resume aforo y disponibilidad para control de acceso y soporte.
                </p>
              </div>
            ) : (
              <div className="bg-card rounded-xl border border-border p-6 space-y-5">
                <img src={event.image} alt={event.title} className="rounded-lg w-full aspect-video object-cover" />
                <p className="font-bold text-foreground text-sm">{event.title}</p>
                <p className="text-xs text-muted-foreground">{event.date} {event.month} {event.year} · {event.venue}</p>
                <p className="text-lg font-black text-primary">{minPrice > 0 ? `Desde $${minPrice.toLocaleString("es-CO")}` : "Gratis"}</p>
                <Link to={buyUrl} className="block w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg text-center text-sm transition-colors">
                  Comprar Boletos Oficiales
                </Link>
              </div>
            )}

            {/* Mercado Secundario Seguro */}
            {!isOperationalRole && <div className="bg-purple-500/5 rounded-xl border border-purple-500/20 p-6 space-y-4 mt-6">
              <h3 className="font-black text-purple-600 uppercase tracking-tight text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Reventa P2P Segura
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">Boletos revendidos por fans, custodiados y garantizados por Secure Ticket sobre Soroban.</p>

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
                        {lt.resalePrice != null && (
                          <p className="text-xs font-black text-purple-600 mt-0.5">
                            {(lt.resalePrice / 10_000_000).toFixed(2)} XLM
                            {xlmCop ? <span className="font-medium text-muted-foreground ml-1">(~ {formatCOP((lt.resalePrice / 10_000_000) * xlmCop)})</span> : ""}
                          </p>
                        )}
                      </div>
                      {walletAddress && walletAddress === lt.sellerWallet ? (
                        <button
                          disabled={cancellingId === lt.id}
                          onClick={async () => {
                            try {
                              setCancellingId(lt.id);
                              setTicketFlowStatus(lt.id, "building_xdr");
                              const result = await cancelResaleListing(lt.id, { onStatus: (status) => setTicketFlowStatus(lt.id, status) });
                              if (result.success) {
                                toast({
                                  title: "Reventa cancelada",
                                  description: "Tu boleto fue retirado del mercado P2P.",
                                });
                                setSuccessDialog({ kind: "cancel", txHash: result.txHash });
                                setLiveTickets((prev) => prev.filter((t) => t.id !== lt.id));
                              } else {
                                toast({
                                  title: "No se pudo cancelar la reventa",
                                  description: result.error ?? "La operación no fue confirmada.",
                                  variant: "destructive",
                                });
                              }
                            } catch (e: unknown) {
                              console.error("[CANCEL] Error:", e);
                              toast({
                                title: "No se pudo cancelar la reventa",
                                description: e instanceof Error ? e.message : "Ocurrió un error retirando el boleto del mercado.",
                                variant: "destructive",
                              });
                            } finally {
                              setCancellingId(null);
                            }
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-red-900/20 disabled:opacity-50"
                        >
                          {cancellingId === lt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          {cancellingId === lt.id ? flowStatusLabel[flowStatusByTicketId[lt.id]] ?? "Cancelando..." : "Cancelar Reventa"}
                        </button>
                      ) : (
                        <button
                          disabled={buyingId === lt.id}
                          onClick={async () => {
                            try {
                              if (!walletAddress) {
                                toast({
                                  title: "Conecta tu wallet",
                                  description: "Necesitas Freighter conectado desde el header para comprar una reventa.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              const pk = walletAddress;
                              setBuyingId(lt.id);
                              setTicketFlowStatus(lt.id, "building_xdr");
                              await linkWallet(pk);
                              const buyResult = await buyResaleTicket(lt.contractAddress, lt.ticketRootId, pk, lt.version, {
                                onStatus: (status) => setTicketFlowStatus(lt.id, status),
                              });
                              if (buyResult.success) {
                                toast({
                                  title: "Compra confirmada",
                                  description: `Tu boleto fue reconciliado por el backend${buyResult.txHash ? ` · Tx ${buyResult.txHash.slice(0, 12)}...` : ""}.`,
                                });
                                setSuccessDialog({ kind: "buy", txHash: buyResult.txHash });
                                setLiveTickets((prev) => prev.filter((t) => t.id !== lt.id));
                              } else {
                                toast({
                                  title: "No se pudo comprar la reventa",
                                  description: buyResult.error ?? "La operación no fue confirmada.",
                                  variant: "destructive",
                                });
                              }
                            } catch (e: unknown) {
                              console.error("[BUY] Error:", e);
                              toast({
                                title: "No se pudo comprar la reventa",
                                description: e instanceof Error ? e.message : "Ocurrió un error durante la compra P2P.",
                                variant: "destructive",
                              });
                            } finally {
                              setBuyingId(null);
                            }
                          }}
                          className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-purple-900/20 disabled:opacity-50"
                        >
                          {buyingId === lt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                          {buyingId === lt.id ? flowStatusLabel[flowStatusByTicketId[lt.id]] ?? "Firmando..." : "Comprar"}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>}
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

      <Dialog open={!!successDialog} onOpenChange={(open) => !open && setSuccessDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              {successDialog?.kind === "buy" ? "Compra P2P confirmada" : "Reventa cancelada"}
            </DialogTitle>
            <DialogDescription>
              {successDialog?.kind === "buy"
                ? "Tu boleto aparecerá en Mis Entradas cuando el indexer termine de reflejar la compra."
                : "Tu boleto se retiró del mercado P2P y vuelve a quedar disponible en Mis Entradas."}
            </DialogDescription>
          </DialogHeader>

          {successDialog?.txHash ? (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-xs">
              <div className="text-muted-foreground">Transaction hash</div>
              <div className="font-mono break-all text-foreground">{successDialog.txHash}</div>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${successDialog.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-purple-600 hover:text-purple-700 font-semibold mt-1"
              >
                <ExternalLink className="w-3 h-3" />
                Ver en Stellar Explorer
              </a>
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:gap-0">
            {successDialog?.kind === "buy" ? (
              <Button variant="outline" onClick={() => navigate("/mi-cuenta/entradas")}>
                Ir a Mis Entradas
              </Button>
            ) : null}
            <Button onClick={() => setSuccessDialog(null)} className="bg-purple-600 hover:bg-purple-700 text-white">
              Listo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EventDetail;
