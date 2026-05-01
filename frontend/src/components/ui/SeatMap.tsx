import { useMemo, useCallback } from "react";

// ── Public types ───────────────────────────────────────────────────────────

export type VenueType =
  | "STADIUM" | "THEATER" | "ARENA"
  | "CLUB" | "COLISEUM" | "CONVENTION_CENTER";

export interface SectionConfig {
  id: string;
  name: string;
  price: number;
  serviceFee: number;
  capacity: number;
  maxPerOrder: number;
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
  /** sold/active ticket count per sectionId (ticket_type id) */
  occupancyPerSection?: Record<string, number>;
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

interface MapRow {
  label: string;
  seats: { id: string; row: string; number: number }[];
  sectionId: string;
  sectionIndex: number;
  isFirstRow: boolean;
}

// ── Build rows for a section ───────────────────────────────────────────────

function buildRows(section: SectionConfig, sectionIndex: number, colCount: number, maxRows: number): MapRow[] {
  const cap = Math.min(section.capacity, colCount * maxRows);
  const numRows = Math.min(maxRows, Math.ceil(cap / colCount));
  const rows: MapRow[] = [];
  let remaining = cap;
  for (let r = 0; r < numRows; r++) {
    const label = String.fromCharCode(65 + r);
    const n = Math.min(colCount, remaining);
    const seats = Array.from({ length: n }, (_, c) => ({
      id: `${section.id}-${label}${c + 1}`,
      row: label,
      number: c + 1,
    }));
    rows.push({ label, seats, sectionId: section.id, sectionIndex, isFirstRow: r === 0 });
    remaining -= n;
  }
  return rows;
}

// ── Build occupied set from real occupancy counts ──────────────────────────
// Marks the first N seat IDs (in row order) as occupied for each section.

function buildOccupiedFromRows(rows: MapRow[], occupancyPerSection: Record<string, number>): Set<string> {
  const occupied = new Set<string>();
  const added: Record<string, number> = {};
  for (const row of rows) {
    const quota = occupancyPerSection[row.sectionId] ?? 0;
    for (const seat of row.seats) {
      if ((added[row.sectionId] ?? 0) >= quota) break;
      occupied.add(seat.id);
      added[row.sectionId] = (added[row.sectionId] ?? 0) + 1;
    }
  }
  return occupied;
}

// ── Shared seat button ─────────────────────────────────────────────────────

interface SeatBtnProps {
  seat: { id: string; row: string; number: number };
  sectionId: string;
  sectionIndex: number;
  sectionMap: Record<string, SectionConfig>;
  selectedIds: Set<string>;
  occupiedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
  size?: "sm" | "xs";
}

function SeatBtn({ seat, sectionId, sectionIndex, sectionMap, selectedIds, occupiedIds, maxReached, onToggle, size = "sm" }: SeatBtnProps) {
  const isSel = selectedIds.has(seat.id);
  const isOcc = occupiedIds.has(seat.id);
  const isBlocked = !isSel && !isOcc && maxReached;
  const disabled = isOcc || isBlocked;
  const p = PALETTE[sectionIndex % PALETTE.length];
  const section = sectionMap[sectionId];
  const dim = size === "xs" ? "w-5 h-5 text-[7px]" : "w-6 h-6 text-[8px]";

  let bgStyle: React.CSSProperties = {};
  let extraClass = "";

  if (isSel) {
    bgStyle = {
      backgroundColor: p.available,
      color: "white",
      boxShadow: `0 0 0 2px white, 0 0 0 3.5px ${p.available}`,
    };
    extraClass = "scale-110 cursor-pointer";
  } else if (isOcc) {
    extraClass = "bg-muted-foreground/20 text-transparent cursor-not-allowed";
  } else if (isBlocked) {
    extraClass = "bg-muted/60 text-transparent cursor-not-allowed opacity-50";
  } else {
    bgStyle = {
      backgroundColor: hexAlpha(p.available, 0.15),
      color: p.available,
    };
    extraClass = "hover:scale-105 active:scale-95 cursor-pointer";
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
          ticketTypeId: section.id,
          price: section.price,
          serviceFee: section.serviceFee,
        });
      }}
      title={isOcc ? "Asiento ocupado" : `${seat.row}${seat.number} · ${section?.name} · $${section?.price.toLocaleString("es-CO")}`}
      style={bgStyle}
      className={`${dim} rounded-sm font-bold flex items-center justify-center transition-transform select-none border-0 outline-none shrink-0 ${extraClass}`}
    >
      {isSel ? "✓" : isOcc ? "" : seat.number}
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
  occupiedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
}

function HorizRows({ rows, cols, sectionMap, selectedIds, occupiedIds, maxReached, onToggle }: HorizRowsProps) {
  return (
    <div className="space-y-[3px]">
      {rows.map((row) => (
        <div key={`${row.sectionId}-${row.label}`} className="flex items-center gap-1">
          <span className="w-4 shrink-0 text-[9px] font-bold text-muted-foreground text-right select-none">{row.label}</span>
          <div className="flex gap-[3px]">
            {row.seats.map((seat) => (
              <SeatBtn key={seat.id} seat={seat} sectionId={row.sectionId} sectionIndex={row.sectionIndex}
                sectionMap={sectionMap} selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={onToggle} />
            ))}
            {Array.from({ length: cols - row.seats.length }).map((_, i) => (
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
  occupiedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
}

function VertCols({ rows, reversed, sectionMap, selectedIds, occupiedIds, maxReached, onToggle }: VertColsProps) {
  const display = reversed ? [...rows].reverse() : rows;
  return (
    <div className="flex gap-[3px]">
      {display.map((row) => (
        <div key={`${row.sectionId}-${row.label}`} className="flex flex-col gap-[3px]">
          {row.seats.map((seat) => (
            <SeatBtn key={seat.id} seat={seat} sectionId={row.sectionId} sectionIndex={row.sectionIndex}
              sectionMap={sectionMap} selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={onToggle} size="xs" />
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

const HORIZ_COLS = 14;
const HORIZ_MAX_ROWS = 10;
const VERT_SEATS = 10;
const VERT_MAX_COLS = 8;

interface StadiumLayoutProps {
  sections: SectionConfig[];
  selectedSeats: SelectedSeat[];
  onToggleSeat: (seat: SelectedSeat) => void;
  maxSeats: number;
  occupancyPerSection: Record<string, number>;
}

function StadiumLayout({ sections, selectedSeats, onToggleSeat, maxSeats, occupancyPerSection }: StadiumLayoutProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const positioned = useMemo(() => {
    const r: Record<StadiumPos, Array<{ section: SectionConfig; rows: MapRow[]; pi: number }>> = {
      norte: [], sur: [], occidental: [], oriental: [], extra: [],
    };
    sections.forEach((s, i) => {
      const pos = getStadiumPos(s.name, i);
      const isVert = pos === "occidental" || pos === "oriental";
      const rows = buildRows(s, i, isVert ? VERT_SEATS : HORIZ_COLS, isVert ? VERT_MAX_COLS : HORIZ_MAX_ROWS);
      r[pos].push({ section: s, rows, pi: i });
    });
    return r;
  }, [sections]);

  // Build occupied set from all rows across all positions
  const occupiedIds = useMemo(() => {
    const allRows: MapRow[] = [];
    for (const items of Object.values(positioned)) {
      for (const { rows } of items) allRows.push(...rows);
    }
    return buildOccupiedFromRows(allRows, occupancyPerSection);
  }, [positioned, occupancyPerSection]);

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
            {positioned.norte.map(({ section, rows }) => (
              <HorizRows key={section.id} rows={rows} cols={HORIZ_COLS} sectionMap={sectionMap}
                selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={handleToggle} />
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
                    selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={handleToggle} />
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
                    selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={handleToggle} />
                </div>
              ))}
            </div>
          ) : <div className="w-6" />}
        </div>

        {positioned.sur.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            {positioned.sur.map(({ section, rows }) => (
              <HorizRows key={section.id} rows={rows} cols={HORIZ_COLS} sectionMap={sectionMap}
                selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={handleToggle} />
            ))}
            <div className="flex gap-2 mt-1">
              {positioned.sur.map(({ section, pi }) => <SectionBadge key={section.id} name={section.name} pi={pi} />)}
            </div>
          </div>
        )}

        {positioned.extra.length > 0 && (
          <div className="flex flex-col items-center gap-2 mt-2 pt-2 border-t border-border/40 w-full">
            {positioned.extra.map(({ section, rows, pi }) => (
              <div key={section.id} className="flex flex-col items-center gap-1">
                <SectionBadge name={section.name} pi={pi} />
                <HorizRows rows={rows} cols={HORIZ_COLS} sectionMap={sectionMap}
                  selectedIds={selectedIds} occupiedIds={occupiedIds} maxReached={maxReached} onToggle={handleToggle} />
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

const MAX_CINEMA_SEATS = 150;

function buildCinemaLayout(sections: SectionConfig[]): { rows: MapRow[]; cols: number } {
  const capped = sections.map((s) => ({ ...s, capacity: Math.min(s.capacity, MAX_CINEMA_SEATS) }));
  const total = capped.reduce((a, s) => a + Math.max(1, s.capacity), 0);
  const cols = Math.min(20, Math.max(8, Math.ceil(Math.sqrt(total * 1.5))));
  const rows: MapRow[] = [];
  let rowIdx = 0;
  capped.forEach((s, si) => {
    const cap = Math.max(1, s.capacity);
    const numRows = Math.ceil(cap / cols);
    let remaining = cap;
    for (let r = 0; r < numRows; r++) {
      const label = String.fromCharCode(65 + (rowIdx % 26));
      const n = Math.min(cols, remaining);
      const seats = Array.from({ length: n }, (_, c) => ({
        id: `${s.id}-${label}${c + 1}`,
        row: label,
        number: c + 1,
      }));
      rows.push({ label, seats, sectionId: s.id, sectionIndex: si, isFirstRow: r === 0 });
      remaining -= n;
      rowIdx++;
    }
  });
  return { rows, cols };
}

interface CinemaLayoutProps {
  venueType: VenueType;
  sections: SectionConfig[];
  selectedSeats: SelectedSeat[];
  onToggleSeat: (seat: SelectedSeat) => void;
  maxSeats: number;
  occupancyPerSection: Record<string, number>;
}

function CinemaLayout({ venueType, sections, selectedSeats, onToggleSeat, maxSeats, occupancyPerSection }: CinemaLayoutProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const { rows, cols } = useMemo(() => buildCinemaLayout(sections), [sections]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const occupiedIds = useMemo(
    () => buildOccupiedFromRows(rows, occupancyPerSection),
    [rows, occupancyPerSection]
  );

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
                        sectionMap={sectionMap} selectedIds={selectedIds} occupiedIds={occupiedIds}
                        maxReached={maxReached} onToggle={handleToggle} />
                    ))}
                    {Array.from({ length: cols - row.seats.length }).map((_, i) => (
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

export function SeatMap({ venueType, venueName, sections, selectedSeats, onToggleSeat, maxSeats = 10, occupancyPerSection = {} }: SeatMapProps) {
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
          occupancyPerSection={occupancyPerSection}
        />
      ) : (
        <CinemaLayout
          venueType={venueType}
          sections={sections}
          selectedSeats={selectedSeats}
          onToggleSeat={onToggleSeat}
          maxSeats={maxSeats}
          occupancyPerSection={occupancyPerSection}
        />
      )}
    </div>
  );
}
