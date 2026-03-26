import { Link } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext } from "@/context/AppContext";
import { ShieldCheck, Calendar, MapPin } from "lucide-react";

const Confirmation = () => {
  const { lastOrder } = useAppContext();

  if (!lastOrder) return (
    <div className="min-h-screen bg-background flex flex-col"><Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-4"><h1 className="text-2xl font-black text-foreground">No hay orden reciente</h1><Link to="/" className="inline-block py-3 px-6 bg-primary text-primary-foreground font-bold rounded-lg text-sm">Ir al Inicio</Link></div>
      </main><Footer /></div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 w-full space-y-6">
        <div className="bg-card rounded-2xl border border-border p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto"><ShieldCheck className="w-8 h-8 text-success" /></div>
          <h1 className="text-2xl font-black text-foreground">¡Compra Confirmada!</h1>
          <p className="text-sm text-muted-foreground">Tu orden <span className="font-bold text-foreground">{lastOrder.orderNumber}</span> ha sido procesada exitosamente.</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-black text-foreground uppercase tracking-tight">Detalle de la Orden</h2>
          {lastOrder.items.map((item) => (
            <div key={item.id} className="flex gap-4 py-3 border-b border-border last:border-0">
              <img src={item.event.image} alt={item.event.title} className="w-16 h-16 rounded-lg object-cover" />
              <div className="flex-1">
                <p className="font-bold text-foreground text-sm">{item.event.title}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5"><Calendar className="w-3 h-3" />{item.event.date} {item.event.month} {item.event.year}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="w-3 h-3" />{item.event.venue}, {item.event.city}</div>
                <p className="text-xs text-primary font-bold mt-1">{item.ticketType.name} × {item.quantity}{item.seats?.length ? ` — Asientos: ${item.seats.join(", ")}` : ""}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-3">
          <h2 className="font-black text-foreground uppercase tracking-tight">Datos del Comprador</h2>
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Nombre:</span> <span className="font-medium text-foreground">{lastOrder.buyerName}</span></div>
            <div><span className="text-muted-foreground">Email:</span> <span className="font-medium text-foreground">{lastOrder.buyerEmail}</span></div>
            <div><span className="text-muted-foreground">Teléfono:</span> <span className="font-medium text-foreground">{lastOrder.buyerPhone}</span></div>
            <div><span className="text-muted-foreground">Documento:</span> <span className="font-medium text-foreground">{lastOrder.buyerDocument}</span></div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span className="text-foreground font-bold">${lastOrder.subtotal.toLocaleString("es-CO")}</span></div>
          <div className="flex justify-between text-sm text-muted-foreground"><span>Servicio</span><span className="text-foreground font-bold">${lastOrder.serviceFees.toLocaleString("es-CO")}</span></div>
          <hr className="border-border" />
          <div className="flex justify-between font-black text-foreground text-lg"><span>Total Pagado</span><span>${lastOrder.total.toLocaleString("es-CO")}</span></div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Link to="/mi-cuenta/entradas" className="flex-1 py-3 bg-primary text-primary-foreground font-bold rounded-lg text-center text-sm hover:bg-primary/90 transition-colors">Ver Mis Entradas</Link>
          <Link to="/" className="flex-1 py-3 bg-secondary text-secondary-foreground font-bold rounded-lg text-center text-sm hover:bg-secondary/80 transition-colors">Seguir Comprando</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Confirmation;
