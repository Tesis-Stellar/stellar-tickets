import { Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP, stroopsToXLM } from "@/hooks/useXlmPrice";
import { ArrowRightLeft } from "lucide-react";

const MySalesP2P = () => {
  const { isLoggedIn, soldTickets } = useAppContext();
  const xlmCop = useXlmPrice();
  if (!isLoggedIn) return <Navigate to="/login" replace />;

  const totalXLM = soldTickets.reduce((sum, t) => sum + t.resalePrice, 0) / 10_000_000;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mis Ventas P2P</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3 space-y-4">
            {/* Resumen */}
            {soldTickets.length > 0 && (
              <div className="bg-gradient-to-r from-purple-500/10 to-green-500/10 rounded-xl border border-purple-500/20 p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-foreground">{soldTickets.length} venta{soldTickets.length !== 1 ? "s" : ""} completada{soldTickets.length !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Historial de reventas P2P en blockchain</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-green-600">+{totalXLM.toFixed(2)} XLM</p>
                  {xlmCop && <p className="text-xs text-green-700 font-medium">~ {formatCOP(totalXLM * xlmCop)}</p>}
                  <p className="text-xs text-muted-foreground">Total recibido</p>
                </div>
              </div>
            )}

            {soldTickets.length === 0 ? (
              <div className="text-center py-16">
                <ArrowRightLeft className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-bold text-foreground">No tienes ventas P2P</p>
                <p className="text-sm text-muted-foreground">Cuando vendas boletos en reventa, apareceran aqui.</p>
              </div>
            ) : (
              soldTickets.map((st) => (
                <div key={st.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
                  {st.event?.image && (
                    <img src={st.event.image} alt={st.event.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-foreground text-sm truncate">{st.event?.title ?? "Evento"}</p>
                    <p className="text-xs text-muted-foreground">
                      {st.ticketType?.name ?? "Boleta"} &middot; Boleto #{st.ticketRootId}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Vendido el {new Date(st.soldAt).toLocaleDateString("es-CO")}
                    </p>
                    {st.buyerWallet && (
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        Comprador: <span className="font-mono text-foreground font-medium">{st.buyerWallet.slice(0, 4)}...{st.buyerWallet.slice(-4)}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-black text-green-600">
                      +{stroopsToXLM(st.resalePrice).toFixed(2)} XLM
                    </p>
                    {xlmCop && (
                      <p className="text-[10px] text-green-700 font-medium">
                        ~ {formatCOP(stroopsToXLM(st.resalePrice) * xlmCop)}
                      </p>
                    )}
                    <span className="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold uppercase mt-0.5 inline-block">Vendido</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default MySalesP2P;
