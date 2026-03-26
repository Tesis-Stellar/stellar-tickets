import { Link } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext } from "@/context/AppContext";
import { Trash2, ShoppingCart, Minus, Plus } from "lucide-react";

const Cart = () => {
  const { cart, removeFromCart, updateCartQuantity, clearCart } = useAppContext();
  const subtotal = cart.reduce((s, c) => s + c.ticketType.price * c.quantity, 0);
  const fees = cart.reduce((s, c) => s + c.ticketType.serviceFee * c.quantity, 0);
  const total = subtotal + fees;

  if (cart.length === 0) return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <ShoppingCart className="w-16 h-16 text-muted-foreground mx-auto" />
          <h1 className="text-2xl font-black text-foreground">Tu carrito está vacío</h1>
          <p className="text-sm text-muted-foreground">Explora eventos y agrega boletos.</p>
          <Link to="/eventos" className="inline-block py-3 px-6 bg-primary text-primary-foreground font-bold rounded-lg text-sm hover:bg-primary/90 transition-colors">Explorar Eventos</Link>
        </div>
      </main>
      <Footer />
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-8">Tu Carrito</h1>
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            {cart.map((item) => (
              <div key={item.id} className="bg-card rounded-xl border border-border p-4 flex gap-4">
                <img src={item.event.image} alt={item.event.title} className="w-20 h-20 rounded-lg object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground text-sm truncate">{item.event.title}</p>
                  <p className="text-xs text-muted-foreground">{item.event.date} {item.event.month} {item.event.year} · {item.event.venue}</p>
                  <p className="text-xs text-primary font-bold mt-1">{item.ticketType.name}{item.seats?.length ? ` — ${item.seats.join(", ")}` : ""}</p>
                </div>
                <div className="flex flex-col items-end justify-between shrink-0">
                  <span className="font-black text-foreground text-sm">${(item.ticketType.price * item.quantity).toLocaleString("es-CO")}</span>
                  {!item.seats?.length && (
                    <div className="flex items-center gap-1">
                      <button onClick={() => void updateCartQuantity(item.id, item.quantity - 1)} className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                      <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                      <button onClick={() => void updateCartQuantity(item.id, item.quantity + 1)} className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                    </div>
                  )}
                  <button onClick={() => void removeFromCart(item.id)} className="text-destructive hover:text-destructive/80 transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-card rounded-xl border border-border p-6 space-y-5 h-fit sticky top-24">
            <h3 className="font-black text-foreground uppercase tracking-tight">Resumen</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="text-foreground font-bold">${subtotal.toLocaleString("es-CO")}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Servicio</span><span className="text-foreground font-bold">${fees.toLocaleString("es-CO")}</span></div>
              <hr className="border-border" />
              <div className="flex justify-between font-black text-foreground text-base"><span>Total</span><span>${total.toLocaleString("es-CO")}</span></div>
            </div>
            <Link to="/checkout" className="block w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg text-center text-sm transition-colors">Continuar al Checkout</Link>
            <button onClick={() => void clearCart()} className="w-full text-center text-xs text-muted-foreground hover:text-destructive transition-colors">Vaciar carrito</button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Cart;
