import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EventCard } from "@/components/ui/EventCard";
import type { EventData } from "@/data/events";

interface CategorySectionProps {
  title: string;
  subtitle?: string;
  events: EventData[];
  bg?: "default" | "white";
}

export const CategorySection = ({ title, subtitle, events, bg = "default" }: CategorySectionProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = 320;
    scrollRef.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <section className={`py-14 md:py-20 ${bg === "white" ? "bg-card border-y border-border" : ""}`}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between mb-6 md:mb-8">
          <div>
            <h2 className="text-2xl md:text-3xl font-black text-foreground uppercase tracking-tight">
              {title}
            </h2>
            {subtitle && <p className="text-muted-foreground font-medium text-sm mt-1">{subtitle}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => scroll("left")}
              className="p-2 border border-border rounded-full hover:bg-secondary transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-foreground" />
            </button>
            <button
              onClick={() => scroll("right")}
              className="p-2 border border-border rounded-full hover:bg-secondary transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-foreground" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-5 md:overflow-visible"
        >
          {events.map((event) => (
            <div key={event.id} className="min-w-[200px] sm:min-w-[220px] md:min-w-0 snap-start">
              <EventCard event={event} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
