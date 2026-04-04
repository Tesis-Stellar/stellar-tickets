import { Link, useLocation } from "react-router-dom";
import { Ticket, ShoppingBag, User, Settings, LogOut, ArrowRightLeft } from "lucide-react";
import { useAppContext } from "@/context/AppContext";

const links = [
  { to: "/mi-cuenta", label: "Panel", icon: Settings, exact: true },
  { to: "/mi-cuenta/entradas", label: "Mis Entradas", icon: Ticket },
  { to: "/mi-cuenta/compras", label: "Mis Compras", icon: ShoppingBag },
  { to: "/mi-cuenta/ventas-p2p", label: "Mis Ventas P2P", icon: ArrowRightLeft },
  { to: "/mi-cuenta/perfil", label: "Mi Perfil", icon: User },
];

export const AccountSidebar = () => {
  const { pathname } = useLocation();
  const { logout } = useAppContext();

  return (
    <aside className="bg-card rounded-xl border border-border p-4 space-y-1">
      {links.map(({ to, label, icon: Icon, exact }) => {
        const active = exact ? pathname === to : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        );
      })}
      <button
        onClick={logout}
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors w-full"
      >
        <LogOut className="w-4 h-4" />
        Cerrar Sesión
      </button>
    </aside>
  );
};
