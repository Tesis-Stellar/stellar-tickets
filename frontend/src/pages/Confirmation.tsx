import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext, type OrderData } from "@/context/AppContext";
import { ShieldCheck, Calendar, MapPin } from "lucide-react";

const Confirmation = () => {
  const { lastOrder, getOrderById } = useAppContext();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [order, setOrder] = useState<OrderData | null>(lastOrder);
  const [loading, setLoading] = useState(Boolean(orderId && (!lastOrder || lastOrder.id !== orderId)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(lastOrder);
      setLoading(false);
      return;
    }
    if (lastOrder?.id === orderId) {
      setOrder(lastOrder);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void getOrderById(orderId)
      .then((freshOrder) => {
        if (!cancelled) setOrder(freshOrder);
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : "No fue posible cargar la orden";
        if (!cancelled) setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getOrderById, lastOrder, orderId]);

  if (loading) return (
    <div className="min-h-screen bg-background flex flex-col"><Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm font-bold text-muted-foreground">Cargando orden...</p>
      </main><Footer /></div>
  );

  if (!order) return (
    <div className="min-h-screen bg-background flex flex-col"><Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-4"><h1 className="text-2xl font-black text-foreground">{error ?? "No hay orden reciente"}</h1><Link to="/" className="inline-block py-3 px-6 bg-primary text-primary-foreground font-bold rounded-lg text-sm">Ir al Inicio</Link></div>
      </main><Footer /></div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 w-full space-y-6">
        <div className="bg-card rounded-2xl border border-border p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto"><ShieldCheck className="w-8 h-8 text-success" /></div>
          <h1 className="text-2xl font-black text-foreground">¡Compra Confirmada!</h1>
          <p className="text-sm text-muted-foreground">Tu orden <span className="font-bold text-foreground">{order.orderNumber}</span> ha sido procesada exitosamente.</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <h2 className="font-black text-foreground uppercase tracking-tight">Detalle de la Orden</h2>
          {order.items.map((item) => (
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
            <div><span className="text-muted-foreground">Nombre:</span> <span className="font-medium text-foreground">{order.buyerName}</span></div>
            <div><span className="text-muted-foreground">Email:</span> <span className="font-medium text-foreground">{order.buyerEmail}</span></div>
            <div><span className="text-muted-foreground">Teléfono:</span> <span className="font-medium text-foreground">{order.buyerPhone}</span></div>
            <div><span className="text-muted-foreground">Documento:</span> <span className="font-medium text-foreground">{order.buyerDocument}</span></div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span className="text-foreground font-bold">${order.subtotal.toLocaleString("es-CO")}</span></div>
          <div className="flex justify-between text-sm text-muted-foreground"><span>Servicio</span><span className="text-foreground font-bold">${order.serviceFees.toLocaleString("es-CO")}</span></div>
          <hr className="border-border" />
          <div className="flex justify-between font-black text-foreground text-lg"><span>Total Pagado</span><span>${order.total.toLocaleString("es-CO")}</span></div>
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
