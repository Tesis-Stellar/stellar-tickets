import { useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { Ticket, ShoppingBag, User, Settings, ArrowRightLeft, MessageSquareText, QrCode, ShieldCheck } from "lucide-react";
import AdminDashboard from "./AdminDashboard";

const Account = () => {
  const { isLoggedIn, authStatus, user, purchasedTickets, soldTickets, refreshTickets, refreshSoldTickets } = useAppContext();
  useEffect(() => {
    if (!isLoggedIn) return;
    refreshTickets().catch(() => {});
    refreshSoldTickets().catch(() => {});
    const id = window.setInterval(() => {
      refreshTickets().catch(() => {});
      refreshSoldTickets().catch(() => {});
    }, 8000);
    return () => window.clearInterval(id);
  }, [isLoggedIn, refreshSoldTickets, refreshTickets]);

  if (authStatus === "checking") {
    return <div className="min-h-screen bg-background flex flex-col"><Header /><main className="flex-1 flex items-center justify-center px-4"><p className="text-sm font-bold text-muted-foreground">Cargando sesión...</p></main><Footer /></div>;
  }
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (user?.role === "ADMIN") return <AdminDashboard />;
  if (user?.role === "STAFF") {
    const staffCards = [
      { to: "/escanear", icon: QrCode, label: "Secure Ticket Scanner", value: "Validación en puerta" },
      { to: "/mi-cuenta/perfil", icon: User, label: "Perfil", value: user?.name ?? "" },
      { to: "/contactanos", icon: ShieldCheck, label: "Ayuda operativa", value: "Soporte y FAQ" },
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
              <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
                Esta cuenta es operativa. Puede validar entradas y gestionar su perfil, pero no puede comprar boletos ni usar carrito.
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {staffCards.map((c) => (
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
  }

  const purchasesCount = purchasedTickets.length;

  const cards = [
    { to: "/mi-cuenta/entradas", icon: Ticket, label: "Mis Entradas", value: `${purchasedTickets.length} boleto${purchasedTickets.length !== 1 ? "s" : ""}` },
    { to: "/mi-cuenta/compras", icon: ShoppingBag, label: "Mis Compras", value: `${purchasesCount} compra${purchasesCount !== 1 ? "s" : ""}` },
    { to: "/mi-cuenta/ventas-p2p", icon: ArrowRightLeft, label: "Mis Ventas P2P", value: `${soldTickets.length} venta${soldTickets.length !== 1 ? "s" : ""}` },
    { to: "/mi-cuenta/reclamos", icon: MessageSquareText, label: "PQR y Reclamos", value: "Soporte con evidencia" },
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
