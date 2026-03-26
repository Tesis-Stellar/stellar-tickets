import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu, X, ShoppingCart, User, Search } from "lucide-react";
import { useAppContext } from "@/context/AppContext";

const navItems = [
  { label: "Inicio", to: "/" },
  { label: "Eventos", to: "/eventos" },
  { label: "Conciertos", to: "/eventos/conciertos" },
  { label: "Teatro", to: "/eventos/teatro" },
  { label: "Deportes", to: "/eventos/deportes" },
  { label: "Festivales", to: "/eventos/festivales" },
  { label: "Contáctanos", to: "/contactanos" },
];

export const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { cart, isLoggedIn } = useAppContext();
  const navigate = useNavigate();
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  return (
    <header className="sticky top-0 z-50 bg-primary shadow-lg">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 h-16">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <span className="text-accent-foreground font-black text-sm">TT</span>
          </div>
          <span className="text-primary-foreground font-black text-xl tracking-tight hidden sm:block">TuTicket</span>
        </Link>
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className="px-3 py-2 text-sm font-semibold text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10 rounded-lg transition-colors">{item.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/buscar")} className="p-2 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 rounded-lg transition-colors"><Search className="w-5 h-5" /></button>
          <Link to="/carrito" className="relative p-2 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 rounded-lg transition-colors">
            <ShoppingCart className="w-5 h-5" />
            {cartCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-accent text-accent-foreground rounded-full text-xs font-black flex items-center justify-center">{cartCount}</span>}
          </Link>
          <Link to={isLoggedIn ? "/mi-cuenta" : "/login"} className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10 rounded-lg transition-colors">
            <User className="w-4 h-4" /><span>{isLoggedIn ? "Mi Cuenta" : "Ingresar"}</span>
          </Link>
          <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden p-2 text-primary-foreground/70 hover:text-primary-foreground rounded-lg transition-colors">
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <div className="lg:hidden bg-primary border-t border-primary-foreground/10 px-4 pb-4">
          {navItems.map((item) => (<Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)} className="block py-2.5 text-sm font-semibold text-primary-foreground/80 hover:text-primary-foreground">{item.label}</Link>))}
          <Link to={isLoggedIn ? "/mi-cuenta" : "/login"} onClick={() => setMobileOpen(false)} className="block py-2.5 text-sm font-semibold text-accent">{isLoggedIn ? "Mi Cuenta" : "Ingresar / Registrarse"}</Link>
        </div>
      )}
    </header>
  );
};
