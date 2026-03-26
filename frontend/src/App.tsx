import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProvider } from "@/context/AppContext";
import Index from "./pages/Index";
import EventDetail from "./pages/EventDetail";
import EventsList from "./pages/EventsList";
import SearchResults from "./pages/SearchResults";
import TicketPurchase from "./pages/TicketPurchase";
import SeatSelection from "./pages/SeatSelection";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Confirmation from "./pages/Confirmation";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Account from "./pages/Account";
import MyTicketsAccount from "./pages/MyTicketsAccount";
import PurchaseHistory from "./pages/PurchaseHistory";
import Profile from "./pages/Profile";
import Contact from "./pages/Contact";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/eventos" element={<EventsList />} />
            <Route path="/eventos/:category" element={<EventsList />} />
            <Route path="/buscar" element={<SearchResults />} />
            <Route path="/evento/:id" element={<EventDetail />} />
            <Route path="/evento/:id/boletas" element={<TicketPurchase />} />
            <Route path="/evento/:id/asientos" element={<SeatSelection />} />
            <Route path="/carrito" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/confirmacion" element={<Confirmation />} />
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Register />} />
            <Route path="/mi-cuenta" element={<Account />} />
            <Route path="/mi-cuenta/entradas" element={<MyTicketsAccount />} />
            <Route path="/mi-cuenta/compras" element={<PurchaseHistory />} />
            <Route path="/mi-cuenta/perfil" element={<Profile />} />
            <Route path="/contactanos" element={<Contact />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
