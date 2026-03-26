import { Search, X } from "lucide-react";
import { categories, cities } from "@/data/events";

interface FilterPanelProps {
  query: string;
  category: string;
  city: string;
  sort: string;
  onQueryChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onCityChange: (v: string) => void;
  onSortChange: (v: string) => void;
  onClear: () => void;
  totalResults: number;
}

export const FilterPanel = ({
  query, category, city, sort,
  onQueryChange, onCategoryChange, onCityChange, onSortChange, onClear,
  totalResults,
}: FilterPanelProps) => {
  const hasFilters = query || category || city;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar eventos..."
          className="w-full pl-10 pr-4 py-2.5 bg-secondary rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Category */}
      <div>
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Categoría</label>
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="w-full py-2 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* City */}
      <div>
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Ciudad</label>
        <select
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          className="w-full py-2 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todas las ciudades</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Sort */}
      <div>
        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5 block">Ordenar por</label>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="w-full py-2 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Relevancia</option>
          <option value="date">Fecha</option>
          <option value="price-asc">Precio: menor a mayor</option>
          <option value="price-desc">Precio: mayor a menor</option>
        </select>
      </div>

      {/* Results + Clear */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-xs text-muted-foreground">{totalResults} resultado{totalResults !== 1 ? "s" : ""}</span>
        {hasFilters && (
          <button onClick={onClear} className="text-xs text-destructive hover:underline flex items-center gap-1">
            <X className="w-3 h-3" /> Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
};
