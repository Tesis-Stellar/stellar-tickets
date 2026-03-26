import { Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { TicketCard } from "@/components/ui/TicketCard";
import { useAppContext } from "@/context/AppContext";
import { Ticket } from "lucide-react";

const MyTicketsAccount = () => {
  const { isLoggedIn, purchasedTickets } = useAppContext();
  if (!isLoggedIn) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mis Entradas</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3 space-y-4">
            {purchasedTickets.length === 0 ? (
              <div className="text-center py-16">
                <Ticket className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-bold text-foreground">No tienes entradas</p>
                <p className="text-sm text-muted-foreground">Compra boletos para ver tus entradas aquí.</p>
              </div>
            ) : (
              purchasedTickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} />)
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default MyTicketsAccount;
