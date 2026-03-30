import { QrCode, MapPin, Calendar, ShieldCheck, Lock } from "lucide-react";
import type { PurchasedTicket } from "@/context/AppContext";
import { useState } from "react";
import { getPublicKey, isConnected } from "@stellar/freighter-api";

export const TicketCard = ({ ticket }: { ticket: PurchasedTicket }) => {
  const [isMinting, setIsMinting] = useState(false);
  const [isMinted, setIsMinted] = useState(false);

  const claimTicket = async () => {
    try {
      if (!(await isConnected())) {
        alert("Por favor conecta tu billetera Freighter primero en el menú principal.");
        return;
      }
      setIsMinting(true);
      
      const pubKey = await getPublicKey();
      
      // Simulating the Soroban XDR dettonation for the thesis demo
      console.log(`[Freighter] Signing XDR payload for contract associated with ${ticket.event.slug}...`);
      
      // We simulate a 2-second confirmation from the Soroban Testnet
      setTimeout(() => {
        setIsMinted(true);
        setIsMinting(false);
      }, 2000);

    } catch (e) {
      console.error(e);
      setIsMinting(false);
    }
  };

  return (
  <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col sm:flex-row">
    <img
      src={ticket.event.image}
      alt={ticket.event.title}
      className="w-full sm:w-40 h-32 sm:h-auto object-cover"
    />
    <div className="flex-1 p-4 flex flex-col sm:flex-row gap-4">
      <div className="flex-1 space-y-2">
        <h3 className="font-bold text-foreground text-sm">{ticket.event.title}</h3>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          <span>{ticket.event.date} {ticket.event.month} {ticket.event.year} · {ticket.event.time}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          <span>{ticket.event.venue}, {ticket.event.city}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
            {ticket.ticketType.name}
          </span>
          <span className="text-xs text-muted-foreground">× {ticket.quantity}</span>
          {ticket.seats?.length ? (
            <span className="text-xs text-muted-foreground">
              Asientos: {ticket.seats.join(", ")}
            </span>
          ) : null}
        </div>
        </div>
        
        {isMinted ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-success/10 text-success text-xs font-black rounded-lg mt-2 border border-success/20">
            <ShieldCheck className="w-4 h-4" /> Asegurado en Blockchain
          </span>
        ) : (
          <button 
            onClick={claimTicket}
            disabled={isMinting}
            className={`inline-flex items-center gap-1.5 px-4 py-2 mt-2 text-xs font-black rounded-lg transition-all ${isMinting ? "bg-muted text-muted-foreground" : "bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-900/20"}`}
          >
            <Lock className="w-3.5 h-3.5" />
            {isMinting ? "Firmando XDR..." : "Reclamar en Web3"}
          </button>
        )}
      </div>
      {/* QR placeholder */}
      <div className="flex items-center justify-center sm:border-l sm:border-border sm:pl-4">
        <div className="w-20 h-20 bg-secondary rounded-lg flex flex-col items-center justify-center gap-1">
          <QrCode className="w-8 h-8 text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground font-medium">Código QR</span>
        </div>
      </div>
    </div>
  );
};
