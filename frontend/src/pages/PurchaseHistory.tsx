import { Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { ShoppingBag } from "lucide-react";

const PurchaseHistory = () => {
  const { isLoggedIn, orders } = useAppContext();
  if (!isLoggedIn) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mis Compras</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3">
            {orders.length === 0 ? (
              <div className="text-center py-16">
                <ShoppingBag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-bold text-foreground">No tienes compras</p>
                <p className="text-sm text-muted-foreground">Tu historial de compras aparecerá aquí.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border">
                    <th className="text-left py-3 font-bold text-muted-foreground text-xs uppercase">Orden</th>
                    <th className="text-left py-3 font-bold text-muted-foreground text-xs uppercase">Fecha</th>
                    <th className="text-left py-3 font-bold text-muted-foreground text-xs uppercase">Evento</th>
                    <th className="text-right py-3 font-bold text-muted-foreground text-xs uppercase">Total</th>
                    <th className="text-right py-3 font-bold text-muted-foreground text-xs uppercase">Estado</th>
                  </tr></thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-border">
                        <td className="py-3 font-bold text-foreground">{o.orderNumber}</td>
                        <td className="py-3 text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("es-CO")}</td>
                        <td className="py-3 text-foreground">{o.items.map((i) => i.event.title).join(", ")}</td>
                        <td className="py-3 text-right font-bold text-foreground">${o.total.toLocaleString("es-CO")}</td>
                        <td className="py-3 text-right"><span className="px-2 py-0.5 bg-success/10 text-success text-xs font-bold rounded-full">Confirmada</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default PurchaseHistory;
