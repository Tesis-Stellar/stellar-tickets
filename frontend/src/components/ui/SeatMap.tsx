import { useMemo } from "react";

export interface Seat {
  id: string;
  section: string;
  row: string;
  number: number;
  status: "available" | "occupied" | "disabled";
  price: number;
  serviceFee: number;
}

interface SeatMapProps {
  eventId: string;
  selectedSeats: Seat[];
  onToggleSeat: (seat: Seat) => void;
}

const SECTIONS = [
  { name: "VIP", rows: 2, cols: 10, price: 450000, fee: 36000, color: "bg-amber-400" },
  { name: "Platea", rows: 3, cols: 12, price: 280000, fee: 22400, color: "bg-primary" },
  { name: "General", rows: 4, cols: 14, price: 120000, fee: 9600, color: "bg-emerald-500" },
];

function seededRandom(seed: number) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export const SeatMap = ({ eventId, selectedSeats, onToggleSeat }: SeatMapProps) => {
  const seats = useMemo(() => {
    const all: Seat[] = [];
    let seedBase = 0;
    for (let i = 0; i < eventId.length; i++) seedBase += eventId.charCodeAt(i);

    SECTIONS.forEach((section) => {
      for (let r = 0; r < section.rows; r++) {
        const rowLabel = String.fromCharCode(65 + r);
        for (let c = 1; c <= section.cols; c++) {
          const rnd = seededRandom(seedBase + r * 100 + c);
          const status: Seat["status"] =
            rnd < 0.2 ? "occupied" : rnd < 0.05 ? "disabled" : "available";
          all.push({
            id: `${section.name}-${rowLabel}${c}`,
            section: section.name,
            row: rowLabel,
            number: c,
            status,
            price: section.price,
            serviceFee: section.fee,
          });
        }
      }
    });
    return all;
  }, [eventId]);

  const isSelected = (seatId: string) => selectedSeats.some((s) => s.id === seatId);

  return (
    <div className="space-y-6">
      {/* Stage */}
      <div className="mx-auto w-3/4 py-3 bg-muted rounded-t-[100%] text-center">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Escenario</span>
      </div>

      {/* Sections */}
      {SECTIONS.map((section) => {
        const sectionSeats = seats.filter((s) => s.section === section.name);
        const rows = [...new Set(sectionSeats.map((s) => s.row))];
        return (
          <div key={section.name} className="space-y-1">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-3 h-3 rounded-sm ${section.color}`} />
              <span className="text-xs font-bold text-foreground">{section.name}</span>
              <span className="text-xs text-muted-foreground">— ${section.price.toLocaleString("es-CO")}</span>
            </div>
            {rows.map((row) => (
              <div key={row} className="flex items-center justify-center gap-1">
                <span className="w-5 text-[10px] text-muted-foreground font-bold text-right">{row}</span>
                {sectionSeats
                  .filter((s) => s.row === row)
                  .map((seat) => {
                    const sel = isSelected(seat.id);
                    const occupied = seat.status === "occupied";
                    const disabled = seat.status === "disabled";
                    return (
                      <button
                        key={seat.id}
                        disabled={occupied || disabled}
                        onClick={() => onToggleSeat(seat)}
                        title={`${seat.id} - $${seat.price.toLocaleString("es-CO")}`}
                        className={`w-6 h-6 md:w-7 md:h-7 rounded-sm text-[9px] font-bold transition-all ${
                          sel
                            ? "bg-accent text-accent-foreground ring-2 ring-accent scale-110"
                            : occupied
                            ? "bg-muted-foreground/30 text-transparent cursor-not-allowed"
                            : disabled
                            ? "bg-muted text-transparent cursor-not-allowed"
                            : `${section.color}/20 text-foreground/60 hover:${section.color}/50 hover:scale-105 cursor-pointer`
                        }`}
                      >
                        {seat.number}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-4 border-t border-border">
        {[
          { label: "Disponible", cls: "bg-primary/20 border border-primary/30" },
          { label: "Seleccionado", cls: "bg-accent" },
          { label: "Ocupado", cls: "bg-muted-foreground/30" },
        ].map(({ label, cls }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-5 h-5 rounded-sm ${cls}`} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
