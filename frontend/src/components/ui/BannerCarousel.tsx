import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bannerData } from "@/data/events";

const AUTOPLAY_MS = 8000;
const FADE_DURATION_S = 1.1;

export const BannerCarousel = () => {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = () => setCurrent((c) => (c + 1) % bannerData.length);
  const prev = () => setCurrent((c) => (c - 1 + bannerData.length) % bannerData.length);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setCurrent((c) => (c + 1) % bannerData.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const banner = bannerData[current];

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl aspect-[3/1] md:aspect-[4/1] group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="absolute inset-0">
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            key={current}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FADE_DURATION_S, ease: [0.22, 1, 0.36, 1] }}
          >
            <img
              src={banner.image}
              alt={banner.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className={`absolute inset-0 bg-gradient-to-r ${banner.gradient} opacity-80`} />

            <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-16">
              <span className="text-primary-foreground/70 text-xs md:text-sm font-bold uppercase tracking-widest mb-1">
                Evento destacado
              </span>
              <h2 className="text-xl sm:text-2xl md:text-5xl font-black text-primary-foreground tracking-tight mb-1 md:mb-2">
                {banner.title}
              </h2>
              <p className="text-primary-foreground/80 text-sm md:text-lg font-medium mb-4 md:mb-6">
                {banner.subtitle}
              </p>
              <Link
                to="/eventos"
                className="w-fit px-6 md:px-8 py-2.5 md:py-3 bg-accent hover:bg-st-yellow-hover text-accent-foreground font-black rounded-lg transition-all text-sm md:text-base shadow-lg"
              >
                {banner.cta}
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={prev}
        className="absolute left-3 top-1/2 z-20 -translate-y-1/2 p-2 bg-card/30 hover:bg-card/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        aria-label="Banner anterior"
      >
        <ChevronLeft className="w-5 h-5 text-primary-foreground" />
      </button>
      <button
        type="button"
        onClick={next}
        className="absolute right-3 top-1/2 z-20 -translate-y-1/2 p-2 bg-card/30 hover:bg-card/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        aria-label="Banner siguiente"
      >
        <ChevronRight className="w-5 h-5 text-primary-foreground" />
      </button>

      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2">
        {bannerData.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setCurrent(i)}
            className={`h-2 rounded-full transition-all ${
              i === current ? "w-6 bg-accent" : "w-2 bg-primary-foreground/50"
            }`}
            aria-label={`Ir al banner ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
};
