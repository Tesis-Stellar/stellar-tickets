import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { EventCard } from "@/components/ui/EventCard";
import { getEvents, type EventData } from "@/data/events";
import { Search } from "lucide-react";

const SearchResults = () => {
  const [params] = useSearchParams();
  const initial = params.get("q") ?? "";
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<EventData[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    void (async () => {
      try {
        const list = await getEvents({ search: query });
        setResults(list);
      } catch {
        setResults([]);
      }
    })();
  }, [query]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Buscar Eventos</h1>
        <div className="relative max-w-2xl mb-8">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca por artista, evento o lugar..." className="w-full pl-12 pr-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
        </div>
        {query.trim() && <p className="text-sm text-muted-foreground mb-4">{results.length} resultado{results.length !== 1 ? "s" : ""} para "{query}"</p>}
        {results.length === 0 && query.trim() ? (
          <div className="text-center py-20"><p className="text-lg font-bold text-foreground mb-2">Sin resultados</p><p className="text-sm text-muted-foreground">Intenta con otra búsqueda.</p></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default SearchResults;
