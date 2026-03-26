import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Phone, Mail, MapPin, ChevronDown } from "lucide-react";

const faqs = [
  { q: "¿Cómo compro boletos?", a: "Busca tu evento, selecciona los boletos deseados, agrégalos al carrito y completa el proceso de pago." },
  { q: "¿Puedo cancelar mi compra?", a: "Las compras son definitivas. Consulta la política del evento específico para excepciones." },
  { q: "¿Cómo recibo mis boletos?", a: "Recibirás tus boletos digitales por correo electrónico y podrás verlos en tu cuenta." },
  { q: "¿Qué métodos de pago aceptan?", a: "Aceptamos tarjetas de crédito/débito, PSE y Nequi." },
  { q: "¿Qué hago si no recibí mi boleto?", a: "Revisa tu carpeta de spam. Si no lo encuentras, contáctanos y te lo reenviaremos." },
];

const Contact = () => {
  const [open, setOpen] = useState<number | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-8">Contáctanos</h1>
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="bg-card rounded-xl border border-border p-6 space-y-4">
              <h2 className="font-black text-foreground uppercase tracking-tight">Envíanos un mensaje</h2>
              {sent ? (
                <div className="text-center py-8"><p className="text-success font-bold text-lg">¡Mensaje enviado!</p><p className="text-sm text-muted-foreground mt-1">Te responderemos pronto.</p></div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <input type="text" placeholder="Nombre" required className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                  <input type="email" placeholder="Correo electrónico" required className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                  <select className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                    <option>Selecciona un tema</option><option>Problema con mi compra</option><option>No recibí mi boleto</option><option>Solicitar reembolso</option><option>Otro</option>
                  </select>
                  <textarea rows={4} placeholder="Describe tu solicitud..." required className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
                  <button type="submit" className="w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg text-sm transition-colors">Enviar Mensaje</button>
                </form>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border p-6 space-y-3">
              <h3 className="font-bold text-foreground">Información de Contacto</h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground"><Phone className="w-4 h-4 text-primary" />(601) 555-0123</div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground"><Mail className="w-4 h-4 text-primary" />soporte@tuticket.co</div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground"><MapPin className="w-4 h-4 text-primary" />Calle 85 #15-30, Bogotá, Colombia</div>
              <p className="text-xs text-muted-foreground">Horario: Lunes a Viernes 8:00 AM - 6:00 PM</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <h2 className="font-black text-foreground uppercase tracking-tight">Preguntas Frecuentes</h2>
            {faqs.map((faq, i) => (
              <div key={i} className="border-b border-border last:border-0 pb-3">
                <button onClick={() => setOpen(open === i ? null : i)} className="flex items-center justify-between w-full text-left py-2">
                  <span className="font-medium text-sm text-foreground">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open === i ? "rotate-180" : ""}`} />
                </button>
                {open === i && <p className="text-sm text-muted-foreground pb-2">{faq.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Contact;
