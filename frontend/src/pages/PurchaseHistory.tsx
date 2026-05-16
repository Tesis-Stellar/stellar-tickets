import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP, stroopsToXLM } from "@/hooks/useXlmPrice";
import { ShoppingBag, Calendar, MapPin, Armchair, ArrowRightLeft, Ticket as TicketIcon, Loader2 } from "lucide-react";

const PurchaseHistory = () => {
  const { isLoggedIn, authStatus, purchasedTickets, ticketsLoading, refreshTickets } = useAppContext();
  const xlmCop = useXlmPrice();

  useEffect(() => {
    if (!isLoggedIn) return;
    refreshTickets().catch(() => {});
  }, [isLoggedIn, refreshTickets]);

  if (authStatus === "checking") {
    return <div className="min-h-screen bg-background flex flex-col"><Header /><main className="flex-1 flex items-center justify-center px-4"><p className="text-sm font-bold text-muted-foreground">Cargando sesión...</p></main><Footer /></div>;
  }
  if (!isLoggedIn) return <Navigate to="/login" replace />;

  const items = [...purchasedTickets].sort(
    (a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime()
  );
  const p2pCount = items.filter((ticket) => ticket.acquiredViaResale).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mis Compras</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3 space-y-4">
            {ticketsLoading ? (
              <div className="text-center py-16">
                <Loader2 className="w-12 h-12 text-primary mx-auto mb-3 animate-spin" />
                <p className="font-bold text-foreground">Cargando tus compras</p>
                <p className="text-sm text-muted-foreground">Estamos consultando tus boletos y reventas P2P.</p>
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingBag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-bold text-foreground">No tienes compras</p>
                <p className="text-sm text-muted-foreground">Tu historial de compras aparecerá aquí.</p>
              </div>
            ) : (
              <>
                <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {items.length} compra{items.length !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p2pCount > 0
                        ? `${p2pCount} adquirida${p2pCount !== 1 ? "s" : ""} en reventa P2P`
                        : "Compras primarias y reventas P2P"}
                    </p>
                  </div>
                  <ShoppingBag className="w-6 h-6 text-muted-foreground" />
                </div>

                {items.map((ticket) => {
                  const isP2p = Boolean(ticket.acquiredViaResale);
                  const resaleXlm = isP2p && ticket.resalePrice ? stroopsToXLM(ticket.resalePrice) : null;
                  const eventPath = ticket.event?.slug ? `/evento/${ticket.event.slug}` : `/evento/${ticket.event?.id}`;

                  return (
                    <div
                      key={ticket.id}
                      className={`bg-card rounded-xl border p-4 flex gap-4 transition-colors ${
                        isP2p ? "border-purple-500/40 bg-purple-500/5" : "border-border"
                      }`}
                    >
                      {ticket.event?.image && (
                        <Link to={eventPath} className="flex-shrink-0">
                          <img
                            src={ticket.event.image}
                            alt={ticket.event.title}
                            className="w-20 h-20 rounded-lg object-cover"
                          />
                        </Link>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link to={eventPath} className="font-bold text-foreground text-sm truncate hover:underline block">
                              {ticket.event?.title ?? "Evento"}
                            </Link>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                              <TicketIcon className="w-3 h-3" />
                              {ticket.ticketType?.name ?? "Boleta"}
                              {ticket.ticketRootId != null && (
                                <span className="text-muted-foreground/60">· #{ticket.ticketRootId}</span>
                              )}
                            </p>
                          </div>
                          {isP2p && (
                            <span className="text-[10px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold uppercase tracking-wide whitespace-nowrap flex items-center gap-1 border border-purple-300">
                              <ArrowRightLeft className="w-3 h-3" />
                              Reventa P2P
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                          {(ticket.sectionName || ticket.seatLabel) && (
                            <span className="flex items-center gap-1">
                              <Armchair className="w-3 h-3" />
                              {ticket.sectionName}
                              {ticket.sectionName && ticket.seatLabel && " · "}
                              {ticket.seatLabel && <span className="font-medium text-foreground">Silla {ticket.seatLabel}</span>}
                            </span>
                          )}
                          {ticket.event?.venue && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {ticket.event.venue}
                              {ticket.event.city && ` · ${ticket.event.city}`}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Comprado el {new Date(ticket.purchasedAt).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0 self-center">
                        {isP2p ? (
                          <>
                            <p className="text-sm font-black text-purple-700">
                              {resaleXlm != null ? `${resaleXlm.toFixed(2)} XLM` : "Reventa P2P"}
                            </p>
                            {resaleXlm != null && xlmCop && (
                              <p className="text-[10px] text-purple-600 font-medium">
                                ~ {formatCOP(resaleXlm * xlmCop)}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-sm font-black text-foreground">
                            ${(ticket.ticketType?.price ?? 0).toLocaleString("es-CO")}
                          </p>
                        )}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase mt-1 inline-block ${
                            isP2p ? "bg-purple-100 text-purple-800" : "bg-success/10 text-success"
                          }`}
                        >
                          Confirmada
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PurchaseHistory;
