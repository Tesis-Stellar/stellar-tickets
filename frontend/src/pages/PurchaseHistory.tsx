import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP, stroopsToXLM } from "@/hooks/useXlmPrice";
import { ShoppingBag, Calendar, MapPin, Armchair, ArrowRightLeft, Ticket as TicketIcon } from "lucide-react";

const PurchaseHistory = () => {
  const { isLoggedIn, purchasedTickets, refreshTickets } = useAppContext();
  const xlmCop = useXlmPrice();

  useEffect(() => {
    if (!isLoggedIn) return;
    refreshTickets().catch(() => {});
  }, [isLoggedIn, refreshTickets]);

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  // Orden por fecha de compra desc
  const items = [...purchasedTickets].sort(
    (a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime()
  );
  const p2pCount = items.filter((t) => t.acquiredViaResale).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mis Compras</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3 space-y-4">
            {items.length > 0 && (
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
            )}

            {items.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingBag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-bold text-foreground">No tienes compras</p>
                <p className="text-sm text-muted-foreground">Tu historial de compras aparecerá aquí.</p>
              </div>
            ) : (
              items.map((t) => {
                const p2p = !!t.acquiredViaResale;
                const priceXLM = p2p && t.resalePrice ? stroopsToXLM(t.resalePrice) : null;
                // El backend a veces devuelve venue como objeto {name}; normaliza a string.
                const venueName =
                  typeof t.event?.venue === "string"
                    ? t.event.venue
                    : (t.event?.venue as any)?.name ?? "";
                const cityName =
                  typeof t.event?.city === "string"
                    ? t.event.city
                    : (t.event?.city as any)?.name ?? "";
                return (
                  <div
                    key={t.id}
                    className={`bg-card rounded-xl border p-4 flex gap-4 transition-colors ${
                      p2p ? "border-purple-500/40 bg-purple-500/5" : "border-border"
                    }`}
                  >
                    {t.event?.image && (
                      <Link to={`/evento/${t.event.id}`} className="flex-shrink-0">
                        <img
                          src={t.event.image}
                          alt={t.event.title}
                          className="w-20 h-20 rounded-lg object-cover"
                        />
                      </Link>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to={t.event?.id ? `/evento/${t.event.id}` : "#"}
                            className="font-bold text-foreground text-sm truncate hover:underline block"
                          >
                            {t.event?.title ?? "Evento"}
                          </Link>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <TicketIcon className="w-3 h-3" />
                            {t.ticketType?.name ?? "Boleta"}
                            {t.ticketRootId != null && (
                              <span className="text-muted-foreground/60">· #{t.ticketRootId}</span>
                            )}
                          </p>
                        </div>
                        {p2p && (
                          <span className="text-[10px] bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold uppercase tracking-wide whitespace-nowrap flex items-center gap-1 border border-purple-300">
                            <ArrowRightLeft className="w-3 h-3" />
                            Reventa P2P
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                        {(t.sectionName || t.seatLabel) && (
                          <span className="flex items-center gap-1">
                            <Armchair className="w-3 h-3" />
                            {t.sectionName}
                            {t.sectionName && t.seatLabel && " · "}
                            {t.seatLabel && <span className="font-medium text-foreground">Silla {t.seatLabel}</span>}
                          </span>
                        )}
                        {venueName && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {venueName}
                            {cityName && ` · ${cityName}`}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Comprado el {new Date(t.purchasedAt).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
                        </span>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0 self-center">
                      {p2p ? (
                        <>
                          <p className="text-sm font-black text-purple-700">
                            {priceXLM != null ? `${priceXLM.toFixed(2)} XLM` : "Reventa P2P"}
                          </p>
                          {priceXLM != null && xlmCop && (
                            <p className="text-[10px] text-purple-600 font-medium">
                              ~ {formatCOP(priceXLM * xlmCop)}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm font-black text-foreground">
                          ${(t.ticketType?.price ?? 0).toLocaleString("es-CO")}
                        </p>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase mt-1 inline-block ${
                          p2p ? "bg-purple-100 text-purple-800" : "bg-success/10 text-success"
                        }`}
                      >
                        Confirmada
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PurchaseHistory;
