import { Minus, Plus, AlertTriangle } from "lucide-react";
import type { TicketType } from "@/data/events";

interface TicketSelectorProps {
  tickets: TicketType[];
  selected: Record<string, number>;
  onUpdate: (ticketId: string, delta: number) => void;
}

export const TicketSelector = ({ tickets, selected, onUpdate }: TicketSelectorProps) => (
  <div className="space-y-3">
    {tickets.map((ticket) => {
      const qty = selected[ticket.id] ?? 0;
      const soldOut = ticket.available === 0;
      const lowAvail = ticket.available > 0 && ticket.available <= 10;

      return (
        <div
          key={ticket.id}
          className={`flex items-center justify-between rounded-xl p-4 border transition-colors ${
            soldOut
              ? "bg-muted/50 border-border opacity-60"
              : "bg-card border-border hover:border-primary/30"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-bold text-foreground text-sm">{ticket.name}</p>
              {soldOut && (
                <span className="px-2 py-0.5 bg-destructive/10 text-destructive text-[10px] font-bold rounded-full">
                  AGOTADO
                </span>
              )}
              {lowAvail && !soldOut && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                  <AlertTriangle className="w-3 h-3" /> Últimos {ticket.available}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Precio: ${ticket.price.toLocaleString("es-CO")} + ${ticket.serviceFee.toLocaleString("es-CO")} servicio
            </p>
            <p className="text-[10px] text-muted-foreground">Máx. {ticket.maxPerOrder} por orden</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-black text-primary text-sm">${ticket.price.toLocaleString("es-CO")}</span>
            {!soldOut && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onUpdate(ticket.id, -1)}
                  disabled={qty === 0}
                  className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-foreground disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-6 text-center font-bold text-foreground text-sm">{qty}</span>
                <button
                  onClick={() => onUpdate(ticket.id, 1)}
                  disabled={qty >= ticket.maxPerOrder}
                  className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-foreground disabled:opacity-30 hover:bg-muted transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>
);
