import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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
  const presetCategory = category ? categoryMap[category] ?? "" : "";

  const [query, setQuery] = useState("");
  const [cat, setCat] = useState(presetCategory);
  const [city, setCity] = useState("");
  const [sort, setSort] = useState("");
  const [results, setResults] = useState<EventData[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const sortMap: Record<string, string> = { date: "date_asc", "price-asc": "price_asc", "price-desc": "price_desc" };
        const list = await getEvents({
          search: query || undefined,
          category: cat || undefined,
          city: city || undefined,
          sort: sortMap[sort],
        });
        setResults(list);
      } catch {
        setResults([]);
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
            />
          </div>
          <div className="lg:col-span-3">
            {results.length === 0 ? (
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
