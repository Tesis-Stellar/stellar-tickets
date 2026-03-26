import { useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/Header";
import { HeroSearch } from "@/components/layout/HeroSearch";
import { BannerCarousel } from "@/components/ui/BannerCarousel";
import { EventCard } from "@/components/ui/EventCard";
import { PromoStrip } from "@/components/ui/PromoStrip";
import { CategorySection } from "@/components/layout/CategorySection";
import { Footer } from "@/components/layout/Footer";
import { getEvents, getFeaturedEvents, type EventData } from "@/data/events";

const Index = () => {
  const [events, setEvents] = useState<EventData[]>([]);
  const [featuredEvents, setFeaturedEvents] = useState<EventData[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [all, featured] = await Promise.all([getEvents(), getFeaturedEvents()]);
        setEvents(all);
        setFeaturedEvents(featured);
      } catch {
        setEvents([]);
        setFeaturedEvents([]);
      }
    })();
  }, []);

  const concertEvents = useMemo(() => events.filter((e) => e.category.toLowerCase().includes("conci")), [events]);
  const theaterEvents = useMemo(() => events.filter((e) => e.category.toLowerCase().includes("teatro") || e.category.toLowerCase().includes("comedia")), [events]);
  const sportsEvents = useMemo(() => events.filter((e) => e.category.toLowerCase().includes("deporte")), [events]);
  const festivalEvents = useMemo(() => events.filter((e) => e.category.toLowerCase().includes("festival")), [events]);

  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <Header />
      <HeroSearch />

      {/* Main content lifted over hero */}
      <main className="relative z-30">
        {/* Banner carousel */}
        <div className="max-w-7xl mx-auto px-4 -mt-8 md:-mt-12 mb-10 md:mb-14">
          <BannerCarousel />
        </div>

        {/* Featured events */}
        <div className="max-w-7xl mx-auto px-4 pb-10 md:pb-16">
          <div className="flex items-center justify-between mb-6 md:mb-8">
            <h2 className="text-2xl md:text-3xl font-black text-foreground uppercase tracking-tight">
              Eventos Destacados
            </h2>
            <a href="#" className="text-primary font-bold text-sm hover:underline">
              Ver todos →
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {featuredEvents.map((event) => (
              <EventCard key={event.id} event={event} featured={event.featured} />
            ))}
          </div>
        </div>

        {/* Promo strip */}
        <PromoStrip />

        {/* Category sections */}
        <CategorySection
          title="Conciertos"
          subtitle="La mejor música en vivo"
          events={concertEvents}
          bg="white"
        />

        <CategorySection
          title="Teatro y Comedia"
          subtitle="Las mejores obras y espectáculos"
          events={theaterEvents}
        />

        <CategorySection
          title="Deportes"
          subtitle="Fútbol, running y más"
          events={sportsEvents}
          bg="white"
        />

        {/* Festival special section */}
        <section className="py-14 md:py-20 bg-gradient-to-b from-background to-primary/5">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-end justify-between mb-6 md:mb-8">
              <div>
                <span className="text-accent text-xs font-black uppercase tracking-widest">Imperdibles</span>
                <h2 className="text-2xl md:text-3xl font-black text-foreground uppercase tracking-tight">
                  Festivales Internacionales
                </h2>
                <p className="text-muted-foreground font-medium text-sm mt-1">
                  Las experiencias más grandes del año
                </p>
              </div>
              <a href="#" className="text-primary font-bold text-sm hover:underline">
                Ver todos →
              </a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {festivalEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
