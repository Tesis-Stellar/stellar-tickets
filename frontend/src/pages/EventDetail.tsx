import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getEventBySlug, getEventTicketTypes, getRelatedEvents, type EventData, type LiveTicket } from "@/data/events";
import { MapPin, Calendar, Clock, ChevronLeft, User, Info, ShieldCheck, Lock, Loader2, AlertTriangle, ExternalLink, CheckCircle2 } from "lucide-react";
import { EventCard } from "@/components/ui/EventCard";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP } from "@/hooks/useXlmPrice";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const EventDetail = () => {
  const { id: slug } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventData | null>(null);
  const [related, setRelated] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveTickets, setLiveTickets] = useState<LiveTicket[]>([]);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmBuy, setConfirmBuy] = useState<LiveTicket | null>(null);
  const [buyAck, setBuyAck] = useState(false);
  const [successDialog, setSuccessDialog] = useState<{ kind: "buy" | "cancel"; txHash?: string } | null>(null);
  const { buyResaleTicket, cancelResaleListing, linkWallet, walletAddress } = useAppContext();
  const xlmCop = useXlmPrice();

  const doBuy = async (lt: LiveTicket) => {
    setConfirmBuy(null);
    setBuyAck(false);
    try {
      if (!walletAddress) {
        alert("Conecta tu billetera Freighter desde el botón del header primero.");
        return;
      }
      setBuyingId(lt.id);
      await linkWallet(walletAddress).catch(() => {});
      const buyResult = await buyResaleTicket(lt.contractAddress, lt.ticketRootId, walletAddress);
      if (buyResult.success) {
        setLiveTickets((prev) => prev.filter((t) => t.id !== lt.id));
        setSuccessDialog({ kind: "buy", txHash: buyResult.txHash });
      } else {
        alert("Error: " + buyResult.error);
      }
    } catch (e: any) {
      console.error("[BUY] Error:", e);
      alert("Error: " + e.message);
    } finally {
      setBuyingId(null);
    }
  };

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
  const buyUrl = `/evento/${event.id}/asientos`;

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
                              const result = await cancelResaleListing(lt.id);
                              if (result.success) {
                                setLiveTickets((prev) => prev.filter((t) => t.id !== lt.id));
                                setSuccessDialog({ kind: "cancel", txHash: result.txHash });
                              } else {
                                alert("Error: " + result.error);
                              }
                            } catch (e: any) {
                              console.error("[CANCEL] Error:", e);
                              alert("Error: " + e.message);
                            } finally {
                              setCancellingId(null);
                            }
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-red-900/20 disabled:opacity-50"
                        >
                          {cancellingId === lt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          {cancellingId === lt.id ? "Cancelando..." : "Cancelar Reventa"}
                        </button>
                      ) : (
                        <button
                          disabled={buyingId === lt.id}
                          onClick={() => {
                            if (!walletAddress) {
                              alert("Conecta tu billetera Freighter desde el botón del header primero.");
                              return;
                            }
                            setBuyAck(false);
                            setConfirmBuy(lt);
                          }}
                          className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 shadow-md shadow-purple-900/20 disabled:opacity-50"
                        >
                          {buyingId === lt.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                          {buyingId === lt.id ? "Firmando..." : "Comprar"}
                        </button>
                      )}
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

      {/* Confirm buy — disclaimer sobre el QR antes de firmar */}
      <Dialog open={!!confirmBuy} onOpenChange={(o) => !o && setConfirmBuy(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Comprar boleta en reventa P2P</DialogTitle>
            <DialogDescription>
              Estás a punto de comprar el <b>Boleto #{confirmBuy?.ticketRootId}</b> directamente al vendedor. La transacción es atómica en Soroban: si firmas, recibes el NFT y el vendedor recibe el pago.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            {confirmBuy?.resalePrice != null && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Precio:</span>
                  <span className="font-mono font-bold">{(confirmBuy.resalePrice / 10_000_000).toFixed(4)} XLM</span>
                </div>
                {xlmCop && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Equivalente:</span>
                    <span>{formatCOP((confirmBuy.resalePrice / 10_000_000) * xlmCop)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">Tu QR es tu boleta</p>
                <p>
                  Tras la compra recibirás un <b>QR de entrada</b> que representa tu acceso al evento. Cualquiera con una foto o captura de ese QR puede entrar en tu lugar. Si lo compartes, regalas tu boleta.
                </p>
                <p>
                  Encontrarás tu QR en <b>Mis Entradas</b>. Si activas la opción de Freighter, también podrás escanearlo desde tu wallet en puerta.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input type="checkbox" className="mt-0.5" checked={buyAck} onChange={(e) => setBuyAck(e.target.checked)} />
              <span className="text-xs text-muted-foreground">
                Entiendo que el QR representa mi boleta y que compartirlo equivale a regalar mi entrada.
              </span>
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmBuy(null)}>Cancelar</Button>
            <Button
              disabled={!buyAck}
              onClick={() => confirmBuy && doBuy(confirmBuy)}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Confirmar y firmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success post-buy / post-cancel */}
      <Dialog open={!!successDialog} onOpenChange={(o) => !o && setSuccessDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
              {successDialog?.kind === "buy" ? "¡Compra exitosa!" : "Reventa cancelada"}
            </DialogTitle>
            <DialogDescription>
              {successDialog?.kind === "buy"
                ? "Tu boleto aparecerá en Mis Entradas en unos segundos. El NFT ya se transfirió a tu wallet on-chain."
                : "Tu boleto se retiró del mercado de reventa. Sigue siendo tuyo y aparece en Mis Entradas."}
            </DialogDescription>
          </DialogHeader>

          {successDialog?.txHash && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-xs">
              <div className="text-muted-foreground">Transaction hash</div>
              <div className="font-mono break-all">{successDialog.txHash}</div>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${successDialog.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-purple-500 hover:text-purple-400 mt-1"
              >
                <ExternalLink className="w-3 h-3" /> Ver en Stellar Explorer
              </a>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {successDialog?.kind === "buy" && (
              <Button variant="outline" onClick={() => navigate("/mi-cuenta/entradas")}>
                Ir a Mis Entradas
              </Button>
            )}
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
