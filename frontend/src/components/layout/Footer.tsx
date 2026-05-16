import { Facebook, Instagram, Twitter, Youtube } from "lucide-react";
import { Link } from "react-router-dom";

export const Footer = () => (
  <footer className="bg-primary text-primary-foreground">
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center"><span className="text-accent-foreground font-black text-sm">TT</span></div>
            <span className="font-black text-lg">TuTicket</span>
          </div>
          <p className="text-primary-foreground/60 text-sm leading-relaxed mb-4">Tu plataforma de confianza para comprar boletos a conciertos, teatro, deportes y entretenimiento en vivo en Colombia.</p>
          <div className="flex gap-3">
            {[Facebook, Instagram, Twitter, Youtube].map((Icon, i) => (
              <span key={i} title="Red social fuera del alcance de la demo" className="w-9 h-9 bg-primary-foreground/10 rounded-full flex items-center justify-center text-primary-foreground/35 cursor-not-allowed">
                <Icon className="w-4 h-4" />
              </span>
            ))}
          </div>
        </div>
        <div>
          <h4 className="font-bold text-sm uppercase tracking-wider mb-4 text-accent">Plataforma</h4>
          {["Vende tu evento", "Socios", "Ticket Pass", "App móvil"].map((t) => (
            <span key={t} title="Función no incluida en el demo" className="block text-sm text-primary-foreground/35 mb-2 cursor-not-allowed">{t}</span>
          ))}
        </div>
        <div>
          <h4 className="font-bold text-sm uppercase tracking-wider mb-4 text-accent">Categorías</h4>
          {[{l:"Conciertos",to:"/eventos/conciertos"},{l:"Teatro",to:"/eventos/teatro"},{l:"Deportes",to:"/eventos/deportes"},{l:"Festivales",to:"/eventos/festivales"},{l:"Familiar",to:"/eventos/familiar"}].map((i) => (<Link key={i.to} to={i.to} className="block text-sm text-primary-foreground/60 hover:text-primary-foreground mb-2 transition-colors">{i.l}</Link>))}
        </div>
        <div>
          <h4 className="font-bold text-sm uppercase tracking-wider mb-4 text-accent">Ayuda</h4>
          {[{l:"Contáctanos",to:"/contactanos"},{l:"Preguntas frecuentes",to:"/contactanos"},{l:"Mi cuenta",to:"/mi-cuenta"}].map((i) => (<Link key={i.l} to={i.to} className="block text-sm text-primary-foreground/60 hover:text-primary-foreground mb-2 transition-colors">{i.l}</Link>))}
          <span title="Función no incluida en el demo" className="block text-sm text-primary-foreground/35 mb-2 cursor-not-allowed">Puntos de venta</span>
        </div>
        <div>
          <h4 className="font-bold text-sm uppercase tracking-wider mb-4 text-accent">Legal</h4>
          {["Política de privacidad","Términos y condiciones","Política del consumidor","Tratamiento de datos"].map((t) => (
            <span key={t} title="Documento no incluido en el demo" className="block text-sm text-primary-foreground/35 mb-2 cursor-not-allowed">{t}</span>
          ))}
        </div>
      </div>
    </div>
    <div className="border-t border-primary-foreground/10">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <p className="text-xs text-primary-foreground/40">© 2026 TuTicket S.A.S. NIT: 901.234.567-8</p>
        <div className="flex items-center gap-2 text-xs text-primary-foreground/40"><span>Tel: (601) 555-0123</span><span>·</span><span>soporte@tuticket.co</span></div>
        <div className="flex gap-2">{["Visa","MC","PSE","Nequi"].map((m) => (<span key={m} className="px-2 py-1 bg-primary-foreground/10 rounded text-[10px] font-bold text-primary-foreground/60">{m}</span>))}</div>
      </div>
    </div>
  </footer>
);
