import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { bannerData } from "@/data/events";

export const BannerCarousel = () => {
  const [current, setCurrent] = useState(0);

  const next = () => setCurrent((c) => (c + 1) % bannerData.length);
  const prev = () => setCurrent((c) => (c - 1 + bannerData.length) % bannerData.length);

  const banner = bannerData[current];

  return (
    <div className="relative w-full overflow-hidden rounded-2xl aspect-[3/1] md:aspect-[4/1] group">
      {/* Background image */}
      <img
        src={banner.image}
        alt={banner.title}
        className="absolute inset-0 w-full h-full object-cover transition-all duration-700"
      />
      <div className={`absolute inset-0 bg-gradient-to-r ${banner.gradient} opacity-80`} />

      {/* Content */}
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
        <button className="w-fit px-6 md:px-8 py-2.5 md:py-3 bg-accent hover:bg-st-yellow-hover text-accent-foreground font-black rounded-lg transition-all text-sm md:text-base shadow-lg">
          {banner.cta}
        </button>
      </div>

      {/* Nav arrows */}
      <button
        onClick={prev}
        className="absolute left-3 top-1/2 -translate-y-1/2 p-2 bg-card/30 hover:bg-card/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
      >
        <ChevronLeft className="w-5 h-5 text-primary-foreground" />
      </button>
      <button
        onClick={next}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-card/30 hover:bg-card/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
      >
        <ChevronRight className="w-5 h-5 text-primary-foreground" />
      </button>

      {/* Dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
        {bannerData.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`w-2 h-2 rounded-full transition-all ${
              i === current ? "bg-accent w-6" : "bg-primary-foreground/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
};
