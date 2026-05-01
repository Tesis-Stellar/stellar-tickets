import { useMemo, useCallback } from "react";

// ── Public types ───────────────────────────────────────────────────────────

export type VenueType =
  | "STADIUM" | "THEATER" | "ARENA"
  | "CLUB" | "COLISEUM" | "CONVENTION_CENTER";

export type SeatStatus = "AVAILABLE" | "HELD" | "SOLD" | "BLOCKED";

export interface SeatData {
  seatId: string;
  label: string;
  row: string;
  number: number;
  status: SeatStatus;
}

export interface SectionConfig {
  id: string;
  name: string;
  ticketTypeId: string;
  price: number;
  serviceFee: number;
  maxPerOrder: number;
  seats: SeatData[];
}

export interface SelectedSeat {
  id: string;
  row: string;
  number: number;
  label: string;
  sectionId: string;
  sectionName: string;
  ticketTypeId: string;
  price: number;
  serviceFee: number;
}

export type Seat = SelectedSeat;

interface SeatMapProps {
  venueType: VenueType;
  venueName: string;
  sections: SectionConfig[];
  selectedSeats: SelectedSeat[];
  onToggleSeat: (seat: SelectedSeat) => void;
  maxSeats?: number;
}

// ── Palette ────────────────────────────────────────────────────────────────

const PALETTE = [
  { available: "#7c3aed", label: "bg-violet-100 text-violet-800 border-violet-300" },
  { available: "#0284c7", label: "bg-sky-100 text-sky-800 border-sky-300" },
  { available: "#059669", label: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { available: "#d97706", label: "bg-amber-100 text-amber-800 border-amber-300" },
  { available: "#e11d48", label: "bg-rose-100 text-rose-800 border-rose-300" },
];

function hexAlpha(hex: string, alpha: number): string {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

// ── Row type ───────────────────────────────────────────────────────────────

interface RenderSeat {
  id: string;
  row: string;
  number: number;
  status: SeatStatus;
}

interface MapRow {
  label: string;
  seats: RenderSeat[];
  sectionId: string;
  sectionIndex: number;
  isFirstRow: boolean;
}

// ── Group real seats from the API into rows for rendering ──────────────────
// Uses the seat's actual row_label and seat_number from the DB.

function buildRowsFromSeats(section: SectionConfig, sectionIndex: number): MapRow[] {
  const byRow = new Map<string, SeatData[]>();
  for (const seat of section.seats) {
    const key = seat.row || "";
    const arr = byRow.get(key) ?? [];
    arr.push(seat);
    byRow.set(key, arr);
  }

  const sortedRowKeys = [...byRow.keys()].sort();
  return sortedRowKeys.map((rowKey, i) => {
    const seats = (byRow.get(rowKey) ?? [])
      .slice()
      .sort((a, b) => a.number - b.number)
      .map<RenderSeat>((s) => ({
        id: s.seatId,
        row: s.row,
        number: s.number,
        status: s.status,
      }));
    return {
      label: rowKey || String.fromCharCode(65 + i),
      seats,
      sectionId: section.id,
      sectionIndex,
      isFirstRow: i === 0,
    };
  });
}

// ── Shared seat button ─────────────────────────────────────────────────────

interface SeatBtnProps {
  seat: RenderSeat;
  sectionId: string;
  sectionIndex: number;
  sectionMap: Record<string, SectionConfig>;
  selectedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
  size?: "sm" | "xs";
}

function SeatBtn({ seat, sectionId, sectionIndex, sectionMap, selectedIds, maxReached, onToggle, size = "sm" }: SeatBtnProps) {
  const isSel = selectedIds.has(seat.id);
  const isOcc = seat.status === "SOLD" || seat.status === "HELD";
  const isBlockedSeat = seat.status === "BLOCKED";
  const isCapped = !isSel && !isOcc && !isBlockedSeat && maxReached;
  const disabled = isOcc || isBlockedSeat || isCapped;
  const p = PALETTE[sectionIndex % PALETTE.length];
  const section = sectionMap[sectionId];
  const dim = size === "xs" ? "w-5 h-5 text-[7px]" : "w-6 h-6 text-[8px]";

  let bgStyle: React.CSSProperties = {};
  let extraClass = "";
  let title = "";

  if (isSel) {
    bgStyle = {
      backgroundColor: p.available,
      color: "white",
      boxShadow: `0 0 0 2px white, 0 0 0 3.5px ${p.available}`,
    };
    extraClass = "scale-110 cursor-pointer";
    title = "Seleccionado";
  } else if (isOcc) {
    extraClass = "bg-muted-foreground/20 text-transparent cursor-not-allowed";
    title = seat.status === "SOLD" ? "Asiento vendido" : "Asiento reservado";
  } else if (isBlockedSeat) {
    extraClass = "bg-muted/40 text-transparent cursor-not-allowed opacity-40";
    title = "Asiento bloqueado";
  } else if (isCapped) {
    extraClass = "bg-muted/60 text-transparent cursor-not-allowed opacity-50";
  } else {
    bgStyle = {
      backgroundColor: hexAlpha(p.available, 0.15),
      color: p.available,
    };
    extraClass = "hover:scale-105 active:scale-95 cursor-pointer";
    title = `${seat.row}${seat.number} · ${section?.name} · $${section?.price.toLocaleString("es-CO")}`;
  }

  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (!section || disabled) return;
        onToggle({
          id: seat.id,
          row: seat.row,
          number: seat.number,
          label: `${section.name} ${seat.row}${seat.number}`,
          sectionId: section.id,
          sectionName: section.name,
          ticketTypeId: section.ticketTypeId,
          price: section.price,
          serviceFee: section.serviceFee,
        });
      }}
      title={title}
      style={bgStyle}
      className={`${dim} rounded-sm font-bold flex items-center justify-center transition-transform select-none border-0 outline-none shrink-0 ${extraClass}`}
    >
      {isSel ? "✓" : (isOcc || isBlockedSeat) ? "" : seat.number}
    </button>
  );
}

// ── Section badge (stadium headers) ───────────────────────────────────────

function SectionBadge({ name, pi }: { name: string; pi: number }) {
  const p = PALETTE[pi % PALETTE.length];
  return (
    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${p.label}`}>
      {name}
    </span>
  );
}

// ── Section header (cinema sections) ──────────────────────────────────────

function SectionHeader({ section, pi }: { section: SectionConfig; pi: number }) {
  const p = PALETTE[pi % PALETTE.length];
  return (
    <div className="flex items-center gap-2 mt-4 mb-2 px-1">
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: p.available }} />
      <span className="text-xs font-bold text-foreground">{section.name}</span>
      <span className="text-xs text-muted-foreground">— ${section.price.toLocaleString("es-CO")}</span>
    </div>
  );
}

// ── Horizontal rows (Norte / Sur / cinema) ─────────────────────────────────

interface HorizRowsProps {
  rows: MapRow[];
  cols: number;
  sectionMap: Record<string, SectionConfig>;
  selectedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
}

function HorizRows({ rows, cols, sectionMap, selectedIds, maxReached, onToggle }: HorizRowsProps) {
  return (
    <div className="space-y-[3px]">
      {rows.map((row) => (
        <div key={`${row.sectionId}-${row.label}`} className="flex items-center gap-1">
          <span className="w-4 shrink-0 text-[9px] font-bold text-muted-foreground text-right select-none">{row.label}</span>
          <div className="flex gap-[3px]">
            {row.seats.map((seat) => (
              <SeatBtn key={seat.id} seat={seat} sectionId={row.sectionId} sectionIndex={row.sectionIndex}
                sectionMap={sectionMap} selectedIds={selectedIds} maxReached={maxReached} onToggle={onToggle} />
            ))}
            {Array.from({ length: Math.max(0, cols - row.seats.length) }).map((_, i) => (
              <div key={`pad${i}`} className="w-6 h-6 shrink-0" />
            ))}
          </div>
          <span className="w-4 shrink-0 text-[9px] font-bold text-muted-foreground select-none">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Vertical columns (Occidental / Oriental) ───────────────────────────────

interface VertColsProps {
  rows: MapRow[];
  reversed: boolean;
  sectionMap: Record<string, SectionConfig>;
  selectedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
}

function VertCols({ rows, reversed, sectionMap, selectedIds, maxReached, onToggle }: VertColsProps) {
  const display = reversed ? [...rows].reverse() : rows;
  return (
    <div className="flex gap-[3px]">
      {display.map((row) => (
        <div key={`${row.sectionId}-${row.label}`} className="flex flex-col gap-[3px]">
          {row.seats.map((seat) => (
            <SeatBtn key={seat.id} seat={seat} sectionId={row.sectionId} sectionIndex={row.sectionIndex}
              sectionMap={sectionMap} selectedIds={selectedIds} maxReached={maxReached} onToggle={onToggle} size="xs" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Oval field ─────────────────────────────────────────────────────────────

function OvalField() {
  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{
        background: "linear-gradient(160deg, #14532d 0%, #166534 50%, #15803d 100%)",
        borderRadius: "50%",
        width: 200,
        height: 120,
        border: "3px solid #22c55e",
        boxShadow: "0 0 28px rgba(34,197,94,0.30), inset 0 0 20px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          border: "1.5px solid rgba(255,255,255,0.22)",
          borderRadius: "50%",
          width: 130,
          height: 76,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="text-green-300/60 text-[9px] font-black tracking-widest uppercase">Cancha</span>
      </div>
    </div>
  );
}

// ── Stage visual ───────────────────────────────────────────────────────────

function Stage({ venueType }: { venueType: VenueType }) {
  const isTheater = venueType === "THEATER";
  return (
    <div className="flex flex-col items-center mb-8">
      <div
        className={`w-3/4 py-3 text-center rounded-t-[100%] ${isTheater ? "" : "bg-muted"}`}
        style={isTheater ? { background: "linear-gradient(135deg, #92400e, #b45309, #92400e)" } : undefined}
      >
        <span className={`text-xs font-bold uppercase tracking-widest ${isTheater ? "text-amber-100" : "text-muted-foreground"}`}>
          Escenario
        </span>
      </div>
      <div className="w-3/4 h-3 bg-gradient-to-b from-muted/30 to-transparent" />
    </div>
  );
}

// ── Stadium position detector ──────────────────────────────────────────────

type StadiumPos = "norte" | "sur" | "occidental" | "oriental" | "extra";

function getStadiumPos(name: string, index: number): StadiumPos {
  const n = name.toLowerCase();
  if (n.includes("norte") || n.includes("north")) return "norte";
  if (n.includes("sur") || n.includes("south")) return "sur";
  if (n.includes("occid") || n.includes("oeste") || n.includes("west")) return "occidental";
  if (n.includes("orient") || n.includes("este") || n.includes("east")) return "oriental";
  if (n.includes("palco")) return "norte";
  if (n === "vip") return "sur";
  const fallback: StadiumPos[] = ["norte", "sur", "occidental", "oriental", "extra"];
  return fallback[index % fallback.length];
}

// ── Stadium layout ─────────────────────────────────────────────────────────

interface StadiumLayoutProps {
  sections: SectionConfig[];
  selectedSeats: SelectedSeat[];
  onToggleSeat: (seat: SelectedSeat) => void;
  maxSeats: number;
}

function StadiumLayout({ sections, selectedSeats, onToggleSeat, maxSeats }: StadiumLayoutProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const positioned = useMemo(() => {
    const r: Record<StadiumPos, Array<{ section: SectionConfig; rows: MapRow[]; pi: number; cols: number }>> = {
      norte: [], sur: [], occidental: [], oriental: [], extra: [],
    };
    sections.forEach((s, i) => {
      const pos = getStadiumPos(s.name, i);
      const rows = buildRowsFromSeats(s, i);
      const cols = rows.reduce((m, r) => Math.max(m, r.seats.length), 0);
      r[pos].push({ section: s, rows, pi: i, cols });
    });
    return r;
  }, [sections]);

  const handleToggle = useCallback((seat: SelectedSeat) => onToggleSeat(seat), [onToggleSeat]);

  const legend = (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-5 pt-4 border-t border-border w-full">
      {sections.map((s, i) => {
        const p = PALETTE[i % PALETTE.length];
        const cnt = selectedSeats.filter((x) => x.sectionId === s.id).length;
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: p.available }} />
            <span className="text-xs text-muted-foreground">
              {s.name}{cnt > 0 && <span className="font-bold text-foreground"> ({cnt})</span>}
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-sm bg-muted-foreground/20" />
        <span className="text-xs text-muted-foreground">Ocupado</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-sm flex items-center justify-center text-white text-[8px] font-bold" style={{ backgroundColor: PALETTE[0].available }}>✓</div>
        <span className="text-xs text-muted-foreground">Seleccionado</span>
      </div>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit flex flex-col items-center gap-2 pb-4">

        {positioned.norte.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-2 mb-1">
              {positioned.norte.map(({ section, pi }) => <SectionBadge key={section.id} name={section.name} pi={pi} />)}
            </div>
            {positioned.norte.map(({ section, rows, cols }) => (
              <HorizRows key={section.id} rows={rows} cols={cols} sectionMap={sectionMap}
                selectedIds={selectedIds} maxReached={maxReached} onToggle={handleToggle} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          {positioned.occidental.length > 0 ? (
            <div className="flex flex-col items-center gap-1">
              {positioned.occidental.map(({ section, rows, pi }) => (
                <div key={section.id} className="flex flex-col items-center gap-1">
                  <SectionBadge name={section.name} pi={pi} />
                  <VertCols rows={rows} reversed sectionMap={sectionMap}
                    selectedIds={selectedIds} maxReached={maxReached} onToggle={handleToggle} />
                </div>
              ))}
            </div>
          ) : <div className="w-6" />}

          <OvalField />

          {positioned.oriental.length > 0 ? (
            <div className="flex flex-col items-center gap-1">
              {positioned.oriental.map(({ section, rows, pi }) => (
                <div key={section.id} className="flex flex-col items-center gap-1">
                  <SectionBadge name={section.name} pi={pi} />
                  <VertCols rows={rows} reversed={false} sectionMap={sectionMap}
                    selectedIds={selectedIds} maxReached={maxReached} onToggle={handleToggle} />
                </div>
              ))}
            </div>
          ) : <div className="w-6" />}
        </div>

        {positioned.sur.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            {positioned.sur.map(({ section, rows, cols }) => (
              <HorizRows key={section.id} rows={rows} cols={cols} sectionMap={sectionMap}
                selectedIds={selectedIds} maxReached={maxReached} onToggle={handleToggle} />
            ))}
            <div className="flex gap-2 mt-1">
              {positioned.sur.map(({ section, pi }) => <SectionBadge key={section.id} name={section.name} pi={pi} />)}
            </div>
          </div>
        )}

        {positioned.extra.length > 0 && (
          <div className="flex flex-col items-center gap-2 mt-2 pt-2 border-t border-border/40 w-full">
            {positioned.extra.map(({ section, rows, pi, cols }) => (
              <div key={section.id} className="flex flex-col items-center gap-1">
                <SectionBadge name={section.name} pi={pi} />
                <HorizRows rows={rows} cols={cols} sectionMap={sectionMap}
                  selectedIds={selectedIds} maxReached={maxReached} onToggle={handleToggle} />
              </div>
            ))}
          </div>
        )}

        {legend}
      </div>
    </div>
  );
}

// ── Cinema layout ──────────────────────────────────────────────────────────

interface CinemaLayoutProps {
  venueType: VenueType;
  sections: SectionConfig[];
  selectedSeats: SelectedSeat[];
  onToggleSeat: (seat: SelectedSeat) => void;
  maxSeats: number;
}

function CinemaLayout({ venueType, sections, selectedSeats, onToggleSeat, maxSeats }: CinemaLayoutProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const { rows, cols } = useMemo(() => {
    const all: MapRow[] = [];
    let rowIdx = 0;
    let maxCols = 0;
    sections.forEach((s, si) => {
      const sectionRows = buildRowsFromSeats(s, si);
      sectionRows.forEach((r, j) => {
        all.push({ ...r, isFirstRow: j === 0 });
        maxCols = Math.max(maxCols, r.seats.length);
        rowIdx++;
      });
    });
    return { rows: all, cols: maxCols };
  }, [sections]);

  const handleToggle = useCallback((seat: SelectedSeat) => onToggleSeat(seat), [onToggleSeat]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit px-2 pb-4">
        <Stage venueType={venueType} />

        <div className="space-y-0">
          {rows.map((row) => {
            const section = sectionMap[row.sectionId];
            return (
              <div key={`${row.sectionId}-${row.label}`}>
                {row.isFirstRow && section && <SectionHeader section={section} pi={row.sectionIndex} />}
                <div className="flex items-center justify-center gap-1 mb-[3px]">
                  <span className="w-5 shrink-0 text-[10px] font-bold text-muted-foreground text-right select-none">{row.label}</span>
                  <div className="flex gap-[4px]">
                    {row.seats.map((seat) => (
                      <SeatBtn key={seat.id} seat={seat} sectionId={row.sectionId} sectionIndex={row.sectionIndex}
                        sectionMap={sectionMap} selectedIds={selectedIds}
                        maxReached={maxReached} onToggle={handleToggle} />
                    ))}
                    {Array.from({ length: Math.max(0, cols - row.seats.length) }).map((_, i) => (
                      <div key={`pad-${i}`} className="w-6 h-6" />
                    ))}
                  </div>
                  <span className="w-5 shrink-0 text-[10px] font-bold text-muted-foreground text-left select-none">{row.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-5 mt-6 pt-4 border-t border-border">
          {sections.map((s, i) => {
            const p = PALETTE[i % PALETTE.length];
            const cnt = selectedSeats.filter((x) => x.sectionId === s.id).length;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: p.available }} />
                <span className="text-xs text-muted-foreground">
                  {s.name}{cnt > 0 && <span className="font-bold text-foreground"> ({cnt})</span>}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm bg-muted-foreground/20" />
            <span className="text-xs text-muted-foreground">Ocupado</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: PALETTE[0].available }}>✓</div>
            <span className="text-xs text-muted-foreground">Seleccionado</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main SeatMap ───────────────────────────────────────────────────────────

export function SeatMap({ venueType, venueName, sections, selectedSeats, onToggleSeat, maxSeats = 10 }: SeatMapProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const isStadium = venueType === "STADIUM" || venueType === "COLISEUM";

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No hay secciones configuradas para este evento.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-muted-foreground font-medium">{venueName}</span>
        {maxReached && <span className="text-xs text-destructive font-bold">Máximo {maxSeats} asientos</span>}
      </div>

      {isStadium ? (
        <StadiumLayout
          sections={sections}
          selectedSeats={selectedSeats}
          onToggleSeat={onToggleSeat}
          maxSeats={maxSeats}
        />
      ) : (
        <CinemaLayout
          venueType={venueType}
          sections={sections}
          selectedSeats={selectedSeats}
          onToggleSeat={onToggleSeat}
          maxSeats={maxSeats}
        />
      )}
    </div>
  );
}
