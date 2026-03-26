import { Search, MapPin, CalendarDays, LayoutGrid } from "lucide-react";

export const HeroSearch = () => {
  return (
    <section className="relative bg-primary pt-14 pb-20 md:pt-20 md:pb-28 px-4 overflow-hidden">
      {/* Background shapes */}
      <div className="absolute inset-0 opacity-10 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary-foreground rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-0 w-64 h-64 bg-st-blue-light rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto text-center mb-10 md:mb-14">
        <h1 className="text-3xl sm:text-4xl md:text-6xl font-black text-primary-foreground mb-4 md:mb-6 tracking-tight leading-tight">
          VIVE TUS <span className="text-accent">MEJORES</span> MOMENTOS
        </h1>
        <p className="text-primary-foreground/70 text-base md:text-lg font-medium">
          Busca entre miles de eventos en vivo en Colombia
        </p>
      </div>

      {/* Search bar */}
      <div className="relative z-20 max-w-5xl mx-auto">
        <div className="bg-card rounded-2xl shadow-2xl p-2 flex flex-col md:flex-row items-stretch gap-0 border border-primary-foreground/10">
          {/* Search input */}
          <div className="flex-grow flex items-center px-4 border-b md:border-b-0 md:border-r border-border py-3">
            <Search className="w-5 h-5 text-muted-foreground mr-3 shrink-0" />
            <input
              type="text"
              placeholder="Busca por artista, evento o lugar..."
              className="w-full bg-transparent focus:outline-none text-foreground font-medium placeholder:text-muted-foreground text-sm md:text-base"
            />
          </div>

          {/* Filters row */}
          <div className="flex flex-col sm:flex-row">
            <div className="flex-1 md:w-44 px-4 py-3 border-b sm:border-b-0 sm:border-r border-border flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
              <select className="w-full bg-transparent focus:outline-none text-sm font-bold text-foreground appearance-none cursor-pointer">
                <option>Todas las ciudades</option>
                <option>Bogotá</option>
                <option>Medellín</option>
                <option>Cali</option>
                <option>Barranquilla</option>
              </select>
            </div>
            <div className="flex-1 md:w-44 px-4 py-3 border-b sm:border-b-0 sm:border-r border-border flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-muted-foreground shrink-0" />
              <select className="w-full bg-transparent focus:outline-none text-sm font-bold text-foreground appearance-none cursor-pointer">
                <option>Categoría</option>
                <option>Conciertos</option>
                <option>Teatro</option>
                <option>Deportes</option>
                <option>Festivales</option>
              </select>
            </div>
            <div className="flex-1 md:w-44 px-4 py-3 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
              <select className="w-full bg-transparent focus:outline-none text-sm font-bold text-foreground appearance-none cursor-pointer">
                <option>Cualquier fecha</option>
                <option>Este fin de semana</option>
                <option>Próximos 7 días</option>
                <option>Próximos 30 días</option>
              </select>
            </div>
          </div>

          {/* Search button */}
          <button className="w-full md:w-auto px-8 md:px-10 py-3.5 md:py-4 bg-accent hover:bg-st-yellow-hover text-accent-foreground font-black rounded-xl transition-all shadow-[0_4px_0_hsl(var(--st-yellow-shadow))] active:shadow-none active:translate-y-[2px] text-sm md:text-base uppercase tracking-wide">
            Buscar
          </button>
        </div>
      </div>
    </section>
  );
};
