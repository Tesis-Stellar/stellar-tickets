import { Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { TicketCard } from "@/components/ui/TicketCard";
import { useAppContext } from "@/context/AppContext";
import { Loader2, Ticket } from "lucide-react";

const MyTicketsAccount = () => {
  const { isLoggedIn, authStatus, purchasedTickets, ticketsLoading } = useAppContext();
  if (authStatus === "checking") {
    return <div className="min-h-screen bg-background flex flex-col"><Header /><main className="flex-1 flex items-center justify-center px-4"><p className="text-sm font-bold text-muted-foreground">Cargando sesión...</p></main><Footer /></div>;
  }
  if (!isLoggedIn) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mis Entradas</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3 space-y-4">
            {ticketsLoading && purchasedTickets.length === 0 ? (
              <div className="text-center py-16">
                <Loader2 className="w-12 h-12 text-primary mx-auto mb-3 animate-spin" />
                <p className="font-bold text-foreground">Cargando tus entradas</p>
                <p className="text-sm text-muted-foreground">Estamos consultando tus boletos y su estado en blockchain.</p>
              </div>
            ) : purchasedTickets.length === 0 ? (
              <div className="text-center py-16">
                <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-bold text-foreground">No tienes entradas</p>
                <p className="text-sm text-muted-foreground">Compra boletos para ver tus entradas aquí.</p>
              </div>
            ) : (
              <>
                {ticketsLoading ? (
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Actualizando estado de tus entradas...
                  </div>
                ) : null}
                {purchasedTickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)}
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default MyTicketsAccount;
