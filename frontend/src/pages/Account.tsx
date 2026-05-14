import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { Ticket, ShoppingBag, User, Settings, ArrowRightLeft } from "lucide-react";

const Account = () => {
  const { isLoggedIn, user, purchasedTickets, soldTickets, refreshTickets, refreshSoldTickets } = useAppContext();

  // Refresca al entrar al dashboard y cada 8s; las compras P2P pueden tardar
  // unos segundos en aparecer porque dependen del indexer (~5s polling).
  useEffect(() => {
    if (!isLoggedIn) return;
    refreshTickets().catch(() => {});
    refreshSoldTickets().catch(() => {});
    const id = setInterval(() => {
      refreshTickets().catch(() => {});
      refreshSoldTickets().catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, [isLoggedIn, refreshTickets, refreshSoldTickets]);

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  // "Mis Compras" cuenta tickets (incluye P2P, que no generan orders en DB),
  // alineado con lo que muestra /mi-cuenta/compras.
  const purchasesCount = purchasedTickets.length;

  const cards = [
    { to: "/mi-cuenta/entradas", icon: Ticket, label: "Mis Entradas", value: `${purchasedTickets.length} boleto${purchasedTickets.length !== 1 ? "s" : ""}` },
    { to: "/mi-cuenta/compras", icon: ShoppingBag, label: "Mis Compras", value: `${purchasesCount} compra${purchasesCount !== 1 ? "s" : ""}` },
    { to: "/mi-cuenta/ventas-p2p", icon: ArrowRightLeft, label: "Mis Ventas P2P", value: `${soldTickets.length} venta${soldTickets.length !== 1 ? "s" : ""}` },
    { to: "/mi-cuenta/perfil", icon: User, label: "Mi Perfil", value: user?.name ?? "" },
    { to: "/contactanos", icon: Settings, label: "Ayuda", value: "Soporte y FAQ" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mi Cuenta</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3">
            <p className="text-sm text-muted-foreground mb-6">Bienvenido, <span className="font-bold text-foreground">{user?.name}</span></p>
            <div className="grid sm:grid-cols-2 gap-4">
              {cards.map((c) => (
                <Link key={c.to} to={c.to} className="bg-card rounded-xl border border-border p-6 hover:border-primary/30 transition-colors group">
                  <c.icon className="w-8 h-8 text-primary mb-3" />
                  <p className="font-bold text-foreground group-hover:text-primary transition-colors">{c.label}</p>
                  <p className="text-sm text-muted-foreground">{c.value}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Account;
