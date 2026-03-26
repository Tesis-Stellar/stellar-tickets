import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import type { EventData } from "@/data/events";

interface EventCardProps {
  event: EventData;
  featured?: boolean;
}

export const EventCard = ({ event, featured }: EventCardProps) => {
  return (
    <Link to={`/evento/${event.slug}`}>
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={`group relative flex flex-col bg-card rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-shadow border border-border ${
        featured ? "md:col-span-2 md:row-span-2" : ""
      }`}
    >
      <div className={`relative overflow-hidden ${featured ? "aspect-[3/4]" : "aspect-[2/3]"}`}>
        <img
          src={event.image}
          alt={event.title}
          className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {/* Date badge */}
        <div className="absolute top-3 left-3 bg-card rounded-lg shadow-md px-3 py-1.5 text-center min-w-[50px]">
          <span className="block text-[10px] font-bold text-primary uppercase leading-none">
            {event.month}
          </span>
          <span className="block text-xl font-black text-foreground leading-none text-tabular">
            {event.date}
          </span>
        </div>

        {/* Mobile overlay title */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-foreground/80 to-transparent p-4 md:hidden">
          <span className="text-primary-foreground font-bold text-sm truncate block">
            {event.title}
          </span>
        </div>
      </div>

      <div className="p-4 flex-grow flex flex-col justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary mb-1 block">
            {event.category}
          </span>
          <h3
            className={`font-bold text-foreground leading-tight mb-2 ${
              featured ? "text-lg md:text-2xl" : "text-sm md:text-base line-clamp-2"
            }`}
          >
            {event.title}
          </h3>
          <p className="text-muted-foreground text-sm flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            {event.venue}
          </p>
          <p className="text-muted-foreground/70 text-xs font-medium ml-5">{event.city}</p>
        </div>

        <span className="mt-4 w-full py-2.5 bg-secondary hover:bg-primary hover:text-primary-foreground text-primary font-bold rounded-lg transition-colors text-sm border border-primary/10 hover:border-primary block text-center">
          Comprar Boletos
        </span>
      </div>
    </motion.div>
    </Link>
  );
};
