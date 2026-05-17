import { useMemo, useCallback, useState, type PointerEvent } from "react";

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
  eventTitle?: string;
  eventCategory?: string;
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
  const dim = size === "xs" ? "w-4 h-4 text-[7px]" : "w-6 h-6 text-[8px]";

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
  } else if (seat.status === "SOLD") {
    extraClass = "bg-red-500 text-white cursor-not-allowed opacity-90";
    title = "Asiento vendido";
  } else if (seat.status === "HELD") {
    extraClass = "bg-amber-400 text-amber-950 cursor-not-allowed opacity-90";
    title = "Asiento reservado";
  } else if (isBlockedSeat) {
    extraClass = "bg-slate-400 text-white cursor-not-allowed opacity-70";
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
      {isSel ? "✓" : seat.status === "SOLD" ? "X" : seat.status === "HELD" ? "H" : isBlockedSeat ? "-" : seat.number}
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

function SeatLegend({ sections, selectedSeats }: { sections: SectionConfig[]; selectedSeats: SelectedSeat[] }) {
  return (
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
        <div className="w-4 h-4 rounded-sm bg-red-500 flex items-center justify-center text-white text-[8px] font-bold">X</div>
        <span className="text-xs text-muted-foreground">Vendido</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-sm bg-amber-400 flex items-center justify-center text-amber-950 text-[8px] font-bold">H</div>
        <span className="text-xs text-muted-foreground">Reservado</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-sm bg-slate-400 flex items-center justify-center text-white text-[8px] font-bold">-</div>
        <span className="text-xs text-muted-foreground">Bloqueado</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 rounded-sm flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: PALETTE[0].available }}>✓</div>
        <span className="text-xs text-muted-foreground">Seleccionado</span>
      </div>
    </div>
  );
}

function FadedSeatBlock({ className = "" }: { className?: string }) {
  return (
    <div className={`grid grid-cols-8 gap-[2px] opacity-20 ${className}`}>
      {Array.from({ length: 48 }).map((_, i) => (
        <span key={i} className="w-2 h-2 rounded-[2px] bg-slate-400" />
      ))}
    </div>
  );
}

function SoccerField() {
  return (
    <div className="relative w-[230px] h-[132px] bg-green-500/70 border-4 border-green-200/80 shadow-inner">
      <div className="absolute inset-3 border-2 border-white/35" />
      <div className="absolute top-3 bottom-3 left-1/2 w-[2px] bg-white/35" />
      <div className="absolute left-1/2 top-1/2 w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/35" />
      <div className="absolute left-3 top-1/2 w-12 h-20 -translate-y-1/2 border-2 border-white/30" />
      <div className="absolute right-3 top-1/2 w-12 h-20 -translate-y-1/2 border-2 border-white/30" />
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-black uppercase tracking-widest text-green-950/45">Cancha</span>
    </div>
  );
}

function ArenaStage() {
  return (
    <div className="relative flex flex-col items-center">
      <div className="w-40 h-16 rounded-sm bg-slate-300/80 border border-slate-400 flex items-center justify-center shadow-sm">
        <span className="text-slate-600 text-xs font-black uppercase tracking-widest">Escenario</span>
      </div>
      <div className="w-8 h-12 bg-slate-300/80 border-x border-slate-400" />
    </div>
  );
}

function TheaterStage() {
  return (
    <div className="flex flex-col items-center mb-8">
      <div
        className="h-16 w-[520px] max-w-[75vw] bg-slate-300 border border-slate-400 shadow-sm flex items-center justify-center"
        style={{ clipPath: "polygon(5% 0, 95% 0, 88% 100%, 12% 100%)" }}
      >
        <span className="text-slate-600 text-xs font-black uppercase tracking-widest">Escenario</span>
      </div>
      <div className="w-[420px] max-w-[60vw] h-6 bg-gradient-to-b from-slate-200/70 to-transparent" />
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

// ── Stadium position detector ──────────────────────────────────────────────

type StadiumPos = "norte" | "sur" | "occidental" | "oriental" | "extra";

function getStadiumPos(name: string, index: number): StadiumPos {
  const n = name.toLowerCase();
  if (n.includes("norte") || n.includes("north")) return "norte";
  if (n.includes("sur") || n.includes("south")) return "sur";
  if (n.includes("occid") || n.includes("oeste") || n.includes("west")) return "occidental";
  if (n.includes("orient") || n.includes("este") || n.includes("east")) return "oriental";
  if (n.includes("platea")) return "occidental";
  if (n.includes("vip") || n.includes("palco")) return "oriental";
  if (n.includes("general")) return "norte";
  const fallback: StadiumPos[] = ["norte", "sur", "occidental", "oriental", "extra"];
  return fallback[index % fallback.length];
}

function getArenaPos(name: string, index: number): StadiumPos {
  const n = name.toLowerCase();
  if (n.includes("platea") || n.includes("preferencial")) return "sur";
  if (n.includes("vip") || n.includes("palco")) return "oriental";
  if (n.includes("general")) return "occidental";
  const fallback: StadiumPos[] = ["occidental", "sur", "oriental", "extra"];
  return fallback[index % fallback.length];
}

type ConcertPos = "front" | "back" | "left" | "right" | "floorLeft" | "floorRight";

function isFootballEvent(title?: string, category?: string) {
  const text = `${title ?? ""} ${category ?? ""}`.toLowerCase();
  return /f[uú]tbol|futbol|soccer|partido|final capital|capital cup|liga|copa/.test(text);
}

function getConcertPos(name: string, index: number): ConcertPos {
  const n = name.toLowerCase();
  if (n.includes("vip") || n.includes("palco")) return "front";
  if (n.includes("platea") || n.includes("preferencial")) return "floorLeft";
  if (n.includes("general")) return "left";
  const fallback: ConcertPos[] = ["front", "floorLeft", "floorRight", "left", "right", "back"];
  return fallback[index % fallback.length];
}

function getTheaterDepth(name: string, index: number): number {
  const n = name.toLowerCase();
  if (n.includes("vip") || n.includes("palco")) return 0;
  if (n.includes("platea") || n.includes("preferencial")) return 1;
  if (n.includes("general")) return 2;
  return index + 3;
}

function ConcertStage() {
  return (
    <div className="relative flex items-center justify-center">
      <div className="relative z-10 h-28 w-80 rounded-lg border-2 border-slate-700 bg-white shadow-sm flex items-center justify-center">
        <span className="text-2xl font-black uppercase tracking-tight text-slate-700">Stage</span>
      </div>
      <div className="absolute top-full left-1/2 h-28 w-10 -translate-x-1/2 border-2 border-dashed border-slate-500 bg-slate-100/80" />
    </div>
  );
}

function ConcertAisle({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute h-24 w-40 rounded-sm border-2 border-dashed border-slate-500 bg-slate-200/70 ${className}`} />
  );
}

interface ConcertBlockProps {
  section: SectionConfig;
  rows: MapRow[];
  pi: number;
  className: string;
  orientation?: "horizontal" | "vertical";
  labelSide?: "top" | "right" | "left";
  seatLimit?: number;
  sectionMap: Record<string, SectionConfig>;
  selectedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
}

function ConcertBlock({ section, rows, pi, className, orientation = "horizontal", labelSide = "top", seatLimit = 12, sectionMap, selectedIds, maxReached, onToggle }: ConcertBlockProps) {
  const visibleRows = rows.slice(0, 5);
  const maxCols = visibleRows.reduce((max, row) => Math.max(max, Math.min(seatLimit, row.seats.length)), 0);
  const badge = <SectionBadge name={section.name} pi={pi} />;

  if (orientation === "vertical") {
    return (
      <div className={`absolute flex items-center gap-2 ${className}`}>
        {labelSide === "left" ? badge : null}
        <div className="flex gap-[7px]">
          {visibleRows.map((row) => (
            <div key={`${row.sectionId}-${row.label}`} className="flex flex-col gap-[7px]">
              {row.seats.slice(0, seatLimit).map((seat) => (
                <SeatBtn
                  key={seat.id}
                  seat={seat}
                  sectionId={row.sectionId}
                  sectionIndex={row.sectionIndex}
                  sectionMap={sectionMap}
                  selectedIds={selectedIds}
                  maxReached={maxReached}
                  onToggle={onToggle}
                  size="sm"
                />
              ))}
            </div>
          ))}
        </div>
        {labelSide !== "left" ? badge : null}
      </div>
    );
  }

  return (
    <div className={`absolute flex flex-col items-center gap-2 ${className}`}>
      {labelSide === "top" ? badge : null}
      <div className="space-y-[6px]">
        {visibleRows.map((row) => (
          <div key={`${row.sectionId}-${row.label}`} className="flex items-center justify-center gap-[6px]">
            {row.seats.slice(0, seatLimit).map((seat) => (
              <SeatBtn
                key={seat.id}
                seat={seat}
                sectionId={row.sectionId}
                sectionIndex={row.sectionIndex}
                sectionMap={sectionMap}
                selectedIds={selectedIds}
                maxReached={maxReached}
                onToggle={onToggle}
                size="sm"
              />
            ))}
            {Array.from({ length: Math.max(0, maxCols - Math.min(seatLimit, row.seats.length)) }).map((_, i) => (
              <span key={`pad-${i}`} className="h-6 w-6 shrink-0" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stadium layout ─────────────────────────────────────────────────────────

interface StadiumLayoutProps {
  sections: SectionConfig[];
  selectedSeats: SelectedSeat[];
  onToggleSeat: (seat: SelectedSeat) => void;
  maxSeats: number;
}

interface RadialSectionProps {
  group: { section: SectionConfig; rows: MapRow[]; pi: number };
  startDeg: number;
  endDeg: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rowGap?: number;
  sectionMap: Record<string, SectionConfig>;
  selectedIds: Set<string>;
  maxReached: boolean;
  onToggle: (seat: SelectedSeat) => void;
}

function pointOnEllipse(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + Math.cos(rad) * rx, y: cy + Math.sin(rad) * ry };
}

function RadialSection({ group, startDeg, endDeg, cx, cy, rx, ry, rowGap = 20, sectionMap, selectedIds, maxReached, onToggle }: RadialSectionProps) {
  const outerRx = rx + Math.max(0, group.rows.length - 1) * rowGap;
  const outerRy = ry + Math.max(0, group.rows.length - 1) * (rowGap * 0.66);
  const labelPoint = pointOnEllipse(cx, cy, outerRx + 26, outerRy + 26, (startDeg + endDeg) / 2);
  return (
    <>
      <div
        className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
        style={{ left: labelPoint.x, top: labelPoint.y }}
      >
        <SectionBadge name={group.section.name} pi={group.pi} />
      </div>
      {group.rows.map((row, rowIndex) => {
        const rowRx = rx + rowIndex * rowGap;
        const rowRy = ry + rowIndex * (rowGap * 0.72);
        return row.seats.map((seat, seatIndex) => {
          const t = row.seats.length <= 1 ? 0.5 : seatIndex / (row.seats.length - 1);
          const deg = startDeg + (endDeg - startDeg) * t;
          const p = pointOnEllipse(cx, cy, rowRx, rowRy, deg);
          const tangent = deg + 90;
          return (
            <div
              key={`${row.sectionId}-${row.label}-${seat.id}`}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: p.x, top: p.y, transform: `translate(-50%, -50%) rotate(${tangent}deg)` }}
            >
              <div style={{ transform: `rotate(${-tangent}deg)` }}>
                <SeatBtn seat={seat} sectionId={row.sectionId} sectionIndex={row.sectionIndex}
                  sectionMap={sectionMap} selectedIds={selectedIds} maxReached={maxReached} onToggle={onToggle} size="xs" />
              </div>
            </div>
          );
        });
      })}
    </>
  );
}

function StadiumLayout({ sections, selectedSeats, onToggleSeat, maxSeats, zoom, pan }: ZoomableLayoutProps) {
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
  const stadiumArcs: Record<StadiumPos, { start: number; end: number; rx: number; ry: number }> = {
    norte: { start: -152, end: -28, rx: 232, ry: 132 },
    oriental: { start: -12, end: 64, rx: 252, ry: 138 },
    sur: { start: 28, end: 152, rx: 232, ry: 132 },
    occidental: { start: 116, end: 192, rx: 252, ry: 138 },
    extra: { start: -112, end: -68, rx: 202, ry: 116 },
  };

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-[920px] pb-4 transition-transform duration-200"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="relative mx-auto w-[760px] h-[560px] bg-white overflow-hidden">
          <div className="absolute left-1/2 top-[280px] h-[385px] w-[625px] -translate-x-1/2 -translate-y-1/2 rounded-[48%] border border-slate-200" />
          <div className="absolute left-1/2 top-[280px] h-[190px] w-[350px] -translate-x-1/2 -translate-y-1/2 rounded-[48%] border-[10px] border-slate-100" />
          <div className="absolute left-1/2 top-[280px] -translate-x-1/2 -translate-y-1/2 z-0">
            <SoccerField />
          </div>

          {(Object.keys(positioned) as StadiumPos[]).flatMap((pos) =>
            positioned[pos].map((group, index) => {
              const arc = stadiumArcs[pos];
              const offset = index * 34;
              return (
                <RadialSection
                  key={group.section.id}
                  group={group}
                  startDeg={arc.start}
                  endDeg={arc.end}
                  cx={380}
                  cy={280}
                  rx={arc.rx + offset}
                  ry={arc.ry + offset * 0.62}
                  rowGap={19}
                  sectionMap={sectionMap}
                  selectedIds={selectedIds}
                  maxReached={maxReached}
                  onToggle={handleToggle}
                />
              );
            })
          )}
        </div>

        <SeatLegend sections={sections} selectedSeats={selectedSeats} />
      </div>
    </div>
  );
}

function ArenaLayout({ sections, selectedSeats, onToggleSeat, maxSeats, zoom, pan }: ZoomableLayoutProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);
  const handleToggle = useCallback((seat: SelectedSeat) => onToggleSeat(seat), [onToggleSeat]);
  const positioned = useMemo(() => {
    const r: Record<StadiumPos, Array<{ section: SectionConfig; rows: MapRow[]; pi: number; cols: number }>> = {
      norte: [], sur: [], occidental: [], oriental: [], extra: [],
    };
    sections.forEach((section, pi) => {
      const pos = getArenaPos(section.name, pi);
      const rows = buildRowsFromSeats(section, pi);
      const cols = rows.reduce((max, row) => Math.max(max, row.seats.length), 0);
      r[pos].push({ section, rows, pi, cols });
    });
    return r;
  }, [sections]);

  const arenaArcs: Record<StadiumPos, { start: number; end: number; rx: number; ry: number }> = {
    norte: { start: -148, end: -32, rx: 240, ry: 136 },
    oriental: { start: -20, end: 42, rx: 292, ry: 190 },
    sur: { start: 58, end: 122, rx: 278, ry: 178 },
    occidental: { start: 138, end: 200, rx: 292, ry: 190 },
    extra: { start: -150, end: -30, rx: 246, ry: 140 },
  };

  return (
    <div className="overflow-auto rounded-xl border border-slate-100 bg-white">
      <div
        className="min-w-[900px] h-[640px] pb-4 transition-transform duration-200"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="relative mx-auto w-[900px] h-[600px] bg-white overflow-hidden">
          <div className="absolute left-1/2 top-[335px] h-[360px] w-[660px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-slate-200" />
          <div className="absolute left-1/2 top-[335px] h-[245px] w-[465px] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[14px] border-slate-100" />
          <div className="absolute left-1/2 top-14 -translate-x-1/2">
            <ArenaStage />
          </div>
          <div className="absolute left-1/2 top-[335px] h-[118px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-[45%] bg-green-400/45 border-4 border-green-100 flex items-center justify-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-green-900/45">Arena</span>
          </div>

          {(Object.keys(positioned) as StadiumPos[]).flatMap((pos) =>
            positioned[pos].map((group, index) => {
              const arc = arenaArcs[pos];
              const offset = index * 32;
              return (
                <RadialSection
                  key={group.section.id}
                  group={group}
                  startDeg={arc.start}
                  endDeg={arc.end}
                  cx={450}
                  cy={335}
                  rx={arc.rx + offset}
                  ry={arc.ry + offset * 0.62}
                  rowGap={18}
                  sectionMap={sectionMap}
                  selectedIds={selectedIds}
                  maxReached={maxReached}
                  onToggle={handleToggle}
                />
              );
            })
          )}
        </div>
        <SeatLegend sections={sections} selectedSeats={selectedSeats} />
      </div>
    </div>
  );
}

function ConcertArenaLayout({ sections, selectedSeats, onToggleSeat, maxSeats, zoom, pan }: ZoomableLayoutProps) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);
  const handleToggle = useCallback((seat: SelectedSeat) => onToggleSeat(seat), [onToggleSeat]);
  const positioned = useMemo(() => {
    const r: Record<ConcertPos, Array<{ section: SectionConfig; rows: MapRow[]; pi: number }>> = {
      front: [], back: [], left: [], right: [], floorLeft: [], floorRight: [],
    };
    sections.forEach((section, pi) => {
      r[getConcertPos(section.name, pi)].push({ section, rows: buildRowsFromSeats(section, pi), pi });
    });
    return r;
  }, [sections]);

  const blockConfig: Record<ConcertPos, { className: string; orientation?: "horizontal" | "vertical"; labelSide?: "top" | "right" | "left"; seatLimit?: number; dx: number; dy: number }> = {
    front: { className: "left-[292px] top-12", orientation: "horizontal", labelSide: "top", dx: 0, dy: 86 },
    left: { className: "left-7 top-[318px]", orientation: "horizontal", labelSide: "right", seatLimit: 6, dx: 0, dy: 116 },
    right: { className: "right-12 top-14", orientation: "vertical", labelSide: "left", dx: -124, dy: 0 },
    floorLeft: { className: "left-[286px] top-[534px]", orientation: "horizontal", labelSide: "top", dx: 0, dy: 82 },
    floorRight: { className: "right-[286px] top-[534px]", orientation: "horizontal", labelSide: "top", dx: 0, dy: 82 },
    back: { className: "left-[304px] top-[590px]", orientation: "horizontal", labelSide: "top", dx: 0, dy: -82 },
  };

  return (
    <div className="overflow-auto rounded-xl border border-slate-100 bg-[#f7f5ee]">
      <div
        className="min-w-[900px] h-[760px] pb-4 transition-transform duration-200"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="relative mx-auto w-[900px] h-[710px] overflow-hidden bg-[#f7f5ee]">
          <div className="absolute left-1/2 top-[255px] -translate-x-1/2">
            <ConcertStage />
          </div>

          <ConcertAisle className="left-[92px] top-12 -rotate-[52deg]" />
          <ConcertAisle className="right-[92px] top-12 rotate-[52deg]" />
          <ConcertAisle className="left-[92px] bottom-16 rotate-[52deg]" />
          <ConcertAisle className="right-[92px] bottom-16 -rotate-[52deg]" />

          {(Object.keys(positioned) as ConcertPos[]).flatMap((pos) =>
            positioned[pos].map((group, index) => {
              const cfg = blockConfig[pos];
              return (
                <div
                  key={group.section.id}
                  className="absolute inset-0"
                  style={{ transform: `translate(${cfg.dx * index}px, ${cfg.dy * index}px)` }}
                >
                  <ConcertBlock
                    section={group.section}
                    rows={group.rows}
                    pi={group.pi}
                    className={cfg.className}
                    orientation={cfg.orientation}
                    labelSide={cfg.labelSide}
                    seatLimit={cfg.seatLimit}
                    sectionMap={sectionMap}
                    selectedIds={selectedIds}
                    maxReached={maxReached}
                    onToggle={handleToggle}
                  />
                </div>
              );
            })
          )}
        </div>
        <SeatLegend sections={sections} selectedSeats={selectedSeats} />
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
  zoom: number;
}

interface ZoomableLayoutProps extends StadiumLayoutProps {
  zoom: number;
  pan: { x: number; y: number };
}

interface SeatMapViewportProps {
  children: React.ReactNode;
  className?: string;
  onPan: (dx: number, dy: number) => void;
}

function SeatMapViewport({ children, className = "", onPan }: SeatMapViewportProps) {
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: event.pointerId, x: event.clientX, y: event.clientY });
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    onPan(dx, dy);
    setDrag({ id: event.pointerId, x: event.clientX, y: event.clientY });
  };

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag?.id === event.pointerId) setDrag(null);
  };

  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-100 bg-white ${drag ? "cursor-grabbing" : "cursor-grab"} ${className}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      style={{ touchAction: "none" }}
    >
      {children}
    </div>
  );
}

function CinemaLayout({ sections, selectedSeats, onToggleSeat, maxSeats, zoom, pan }: CinemaLayoutProps & { pan: { x: number; y: number } }) {
  const maxReached = selectedSeats.length >= maxSeats;
  const selectedIds = useMemo(() => new Set(selectedSeats.map((s) => s.id)), [selectedSeats]);
  const sectionMap = useMemo(() => {
    const m: Record<string, SectionConfig> = {};
    for (const s of sections) m[s.id] = s;
    return m;
  }, [sections]);

  const groups = useMemo(() => sections
    .map((section, pi) => {
      const rows = buildRowsFromSeats(section, pi);
      const cols = rows.reduce((m, r) => Math.max(m, r.seats.length), 0);
      return { section, rows, cols, pi, depth: getTheaterDepth(section.name, pi) };
    })
    .sort((a, b) => a.depth - b.depth || a.pi - b.pi), [sections]);

  const handleToggle = useCallback((seat: SelectedSeat) => onToggleSeat(seat), [onToggleSeat]);

  return (
    <div className="overflow-x-auto">
      <div
        className="min-w-[900px] px-2 pb-4 transition-transform duration-200"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "top center" }}
      >
        <div className="relative mx-auto w-[880px] min-h-[610px] bg-white rounded-xl overflow-hidden border border-slate-100 px-10 pb-14">
          <TheaterStage />

          <div className="mt-10 flex flex-col items-center gap-8">
            {groups.map(({ section, rows, cols, pi }, index) => (
              <div
                key={section.id}
                className="flex flex-col items-center gap-2"
                style={{
                  transform: index === 0
                    ? "perspective(900px) rotateX(5deg)"
                    : index === groups.length - 1
                      ? "perspective(900px) rotateX(-3deg)"
                      : undefined,
                }}
              >
                <SectionBadge name={section.name} pi={pi} />
                <HorizRows rows={rows} cols={cols} sectionMap={sectionMap} selectedIds={selectedIds}
                  maxReached={maxReached} onToggle={handleToggle} />
              </div>
            ))}
          </div>
        </div>

        <SeatLegend sections={sections} selectedSeats={selectedSeats} />
      </div>
    </div>
  );
}

// ── Main SeatMap ───────────────────────────────────────────────────────────

export function SeatMap({ venueType, venueName, eventTitle, eventCategory, sections, selectedSeats, onToggleSeat, maxSeats = 10 }: SeatMapProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const maxReached = selectedSeats.length >= maxSeats;
  const isStadium = venueType === "STADIUM";
  const isArena = venueType === "ARENA" || venueType === "COLISEUM";
  const useConcertLayout = isArena || (isStadium && !isFootballEvent(eventTitle, eventCategory));
  const zoomOut = () => setZoom((value) => Math.max(0.65, Number((value - 0.15).toFixed(2))));
  const zoomIn = () => setZoom((value) => Math.min(1.6, Number((value + 0.15).toFixed(2))));
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const movePan = (dx: number, dy: number) => setPan((value) => ({ x: value.x + dx, y: value.y + dy }));

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No hay secciones configuradas para este evento.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-muted-foreground font-medium">{venueName}</span>
        <div className="flex items-center gap-2">
          {maxReached && <span className="text-xs text-destructive font-bold">Máximo {maxSeats} asientos</span>}
          <div className="flex items-center rounded-lg border border-border overflow-hidden bg-background">
            <button type="button" onClick={zoomOut} className="h-8 w-8 text-sm font-black hover:bg-muted" aria-label="Alejar mapa">−</button>
            <button type="button" onClick={resetZoom} className="h-8 px-2 text-[11px] font-bold text-muted-foreground border-x border-border hover:bg-muted">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={zoomIn} className="h-8 w-8 text-sm font-black hover:bg-muted" aria-label="Acercar mapa">+</button>
          </div>
        </div>
      </div>

      <SeatMapViewport onPan={movePan}>
        {useConcertLayout ? (
          <ConcertArenaLayout
            sections={sections}
            selectedSeats={selectedSeats}
            onToggleSeat={onToggleSeat}
            maxSeats={maxSeats}
            zoom={zoom}
            pan={pan}
          />
        ) : isStadium ? (
          <StadiumLayout
            sections={sections}
            selectedSeats={selectedSeats}
            onToggleSeat={onToggleSeat}
            maxSeats={maxSeats}
            zoom={zoom}
            pan={pan}
          />
        ) : isArena ? (
          <ArenaLayout
            sections={sections}
            selectedSeats={selectedSeats}
            onToggleSeat={onToggleSeat}
            maxSeats={maxSeats}
            zoom={zoom}
            pan={pan}
          />
        ) : (
          <CinemaLayout
            venueType={venueType}
            sections={sections}
            selectedSeats={selectedSeats}
            onToggleSeat={onToggleSeat}
            maxSeats={maxSeats}
            zoom={zoom}
            pan={pan}
          />
        )}
      </SeatMapViewport>
    </div>
  );
}
