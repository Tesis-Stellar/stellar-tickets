import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { FilterPanel } from "@/components/ui/FilterPanel";
import { EventCard } from "@/components/ui/EventCard";
import { getEvents, type EventData } from "@/data/events";

const categoryMap: Record<string, string> = {
  conciertos: "Conciertos", teatro: "Teatro", deportes: "Deportes",
  festivales: "Festivales", comedia: "Comedia", familiar: "Familiar",
};

const EventsList = () => {
  const { category } = useParams<{ category?: string }>();
  const [searchParams] = useSearchParams();
  const presetCategory = category ? categoryMap[category] ?? "" : "";

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [cat, setCat] = useState(searchParams.get("category") ?? presetCategory);
  const [city, setCity] = useState(searchParams.get("city") ?? "");
  const [sort, setSort] = useState(searchParams.get("sort") ?? "");
  const [results, setResults] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setCat(searchParams.get("category") ?? presetCategory);
    setCity(searchParams.get("city") ?? "");
    setSort(searchParams.get("sort") ?? "");
  }, [presetCategory, searchParams]);

  useEffect(() => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    void (async () => {
      try {
        const sortMap: Record<string, string> = { date: "date_asc", "price-asc": "price_asc", "price-desc": "price_desc" };
        const list = await getEvents({
          search: query || undefined,
          category: cat || undefined,
          city: city || undefined,
          sort: sortMap[sort],
        });
        if (fetchIdRef.current !== id) return;
        setResults(list);
      } catch {
        if (fetchIdRef.current !== id) return;
        setResults([]);
      } finally {
        if (fetchIdRef.current === id) setLoading(false);
      }
    })();
  }, [cat, city, query, sort]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl md:text-3xl font-black text-foreground uppercase tracking-tight mb-6">
          {presetCategory || "Todos los Eventos"}
        </h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <FilterPanel
              query={query} category={cat} city={city} sort={sort}
              onQueryChange={setQuery} onCategoryChange={setCat} onCityChange={setCity} onSortChange={setSort}
              onClear={() => { setQuery(""); setCat(presetCategory); setCity(""); setSort(""); }}
              totalResults={results.length}
              isLoading={loading}
            />
          </div>
          <div className="lg:col-span-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground" aria-live="polite">
                <Loader2 className="h-10 w-10 animate-spin text-primary" aria-hidden />
                <p className="text-sm font-medium">Cargando eventos…</p>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-lg font-bold text-foreground mb-2">No se encontraron eventos</p>
                <p className="text-sm text-muted-foreground">Intenta con otros filtros o busca algo diferente.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {results.map((e) => <EventCard key={e.id} event={e} />)}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default EventsList;
