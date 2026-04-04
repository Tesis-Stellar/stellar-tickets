import { useState, useEffect } from "react";

const CACHE_KEY = "xlm_cop_price";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

interface CachedPrice {
  price: number;
  timestamp: number;
}

/**
 * Hook que obtiene el precio de XLM en COP desde CoinGecko.
 * Cachea en localStorage por 5 minutos para no abusar del API.
 * Retorna null mientras carga o si falla.
 */
export const useXlmPrice = (): number | null => {
  const [price, setPrice] = useState<number | null>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedPrice = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) return parsed.price;
      }
    } catch { /* ignore */ }
    return null;
  });

  useEffect(() => {
    // Si ya tenemos un precio cacheado válido, no fetch
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: CachedPrice = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL) {
          setPrice(parsed.price);
          return;
        }
      }
    } catch { /* ignore */ }

    let cancelled = false;
    const fetchPrice = async () => {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=cop");
        if (!res.ok) return;
        const data = await res.json();
        const cop = data?.stellar?.cop;
        if (typeof cop === "number" && !cancelled) {
          setPrice(cop);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ price: cop, timestamp: Date.now() }));
        }
      } catch {
        // Silenciosamente falla — el precio COP es informativo
      }
    };
    fetchPrice();
    return () => { cancelled = true; };
  }, []);

  return price;
};

/** Formatea un valor en COP */
export const formatCOP = (amount: number): string =>
  `$${Math.round(amount).toLocaleString("es-CO")} COP`;

/** Convierte stroops a XLM */
export const stroopsToXLM = (stroops: number): number => stroops / 10_000_000;
