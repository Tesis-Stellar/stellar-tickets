export const PromoStrip = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative overflow-hidden rounded-xl aspect-[3/1] bg-gradient-to-r from-primary to-st-blue-light group cursor-pointer">
          <img
            src="https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=80"
            alt="Promo"
            className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:scale-105 transition-transform duration-500"
          />
          <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-10">
            <span className="text-accent text-xs font-black uppercase tracking-widest">Nuevo</span>
            <h3 className="text-primary-foreground font-black text-lg md:text-2xl tracking-tight">
              Ticket Pass Premium
            </h3>
            <p className="text-primary-foreground/70 text-sm font-medium">
              Acceso prioritario a todos los eventos
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl aspect-[3/1] bg-gradient-to-r from-amber-500 to-orange-600 group cursor-pointer">
          <img
            src="https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=800&q=80"
            alt="Promo"
            className="absolute inset-0 w-full h-full object-cover opacity-20 group-hover:scale-105 transition-transform duration-500"
          />
          <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-10">
            <span className="text-foreground/80 text-xs font-black uppercase tracking-widest">Ofertas</span>
            <h3 className="text-foreground font-black text-lg md:text-2xl tracking-tight">
              2x1 en Teatro y Comedia
            </h3>
            <p className="text-foreground/70 text-sm font-medium">
              Solo hasta el 30 de julio
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
