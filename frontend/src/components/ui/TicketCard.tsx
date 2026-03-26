import { QrCode, MapPin, Calendar } from "lucide-react";
import type { PurchasedTicket } from "@/context/AppContext";

export const TicketCard = ({ ticket }: { ticket: PurchasedTicket }) => (
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
        <span className="inline-block px-2 py-0.5 bg-success/10 text-success text-[10px] font-bold rounded-full mt-1">
          Confirmado
        </span>
      </div>
      {/* QR placeholder */}
      <div className="flex items-center justify-center sm:border-l sm:border-border sm:pl-4">
        <div className="w-20 h-20 bg-secondary rounded-lg flex flex-col items-center justify-center gap-1">
          <QrCode className="w-8 h-8 text-muted-foreground" />
          <span className="text-[9px] text-muted-foreground font-medium">Código QR</span>
        </div>
      </div>
    </div>
  </div>
);
