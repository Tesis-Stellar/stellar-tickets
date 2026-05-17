import { useState } from "react";
import { Navigate, Link, useLocation } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CheckoutStepper } from "@/components/ui/CheckoutStepper";
import { useAppContext } from "@/context/AppContext";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";

const Field = ({ label, name, type = "text", placeholder = "", value, onChange, error }: { label: string; name: string; type?: string; placeholder?: string; value: string; onChange: (name: string, value: string) => void; error?: string }) => (
  <div>
    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
    <input type={type} value={value} onChange={(e) => onChange(name, e.target.value)} placeholder={placeholder}
      className={`w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "ring-2 ring-destructive" : ""}`} />
    {error && <p className="text-xs text-destructive mt-1">{error}</p>}
  </div>
);

const Checkout = () => {
  const { cart, checkout, isLoggedIn, authStatus, user } = useAppContext();
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: "", email: "", phone: "", document: "", docType: "CC", payMethod: "card", terms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const subtotal = cart.reduce((s, c) => s + c.ticketType.price * c.quantity, 0);
  const fees = cart.reduce((s, c) => s + c.ticketType.serviceFee * c.quantity, 0);
  const total = subtotal + fees;

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen bg-background flex flex-col"><Header />
        <main className="flex-1 flex items-center justify-center px-4"><p className="text-sm font-bold text-muted-foreground">Cargando sesión...</p></main>
      <Footer /></div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname, message: "Inicia sesión para finalizar la compra." }} />;
  }

  if (user?.role !== "CUSTOMER") {
    return (
      <div className="min-h-screen bg-background flex flex-col"><Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-4 max-w-md">
            <CreditCard className="w-16 h-16 text-muted-foreground mx-auto" />
            <h1 className="text-2xl font-black text-foreground">Checkout no disponible</h1>
            <p className="text-sm text-muted-foreground">Las cuentas operativas no pueden comprar boletos ni confirmar pagos simulados.</p>
            <Link to="/mi-cuenta" className="inline-block py-3 px-6 bg-primary text-primary-foreground font-bold rounded-lg text-sm">Volver a Mi Cuenta</Link>
          </div>
        </main>
      <Footer /></div>
    );
  }

  if (cart.length === 0 && step < 3) return (
    <div className="min-h-screen bg-background flex flex-col"><Header />
      <main className="flex-1 flex items-center justify-center px-4"><div className="text-center space-y-4"><h1 className="text-2xl font-black text-foreground">Tu carrito está vacío</h1><Link to="/eventos" className="inline-block py-3 px-6 bg-primary text-primary-foreground font-bold rounded-lg text-sm">Explorar Eventos</Link></div></main>
    <Footer /></div>
  );

  const validate1 = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Nombre requerido";
    if (!form.email.includes("@")) e.email = "Email inválido";
    if (form.phone.length < 7) e.phone = "Teléfono inválido";
    if (form.document.length < 5) e.document = "Documento inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validate2 = () => {
    if (!form.terms) { setErrors({ terms: "Acepta los términos" }); return false; }
    setErrors({});
    return true;
  };

  const handleNext = async () => {
    if (isSubmitting) return;
    setSubmitError(null);
    if (step === 1 && validate1()) setStep(2);
    else if (step === 2 && validate2()) {
      const paymentMap: Record<string, "CARD" | "PSE" | "CASHPOINT"> = {
        card: "CARD",
        pse: "PSE",
        nequi: "CASHPOINT",
      };
      setIsSubmitting(true);
      try {
        const order = await checkout({
          name: form.name,
          email: form.email,
          phone: form.phone,
          document: `${form.docType} ${form.document}`,
          paymentMethod: paymentMap[form.payMethod] ?? "CARD",
        });
        setCompletedOrderId(order?.id ?? null);
        setStep(3);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "No se pudo confirmar la compra");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleFieldChange = (name: string, value: string) => setForm((p) => ({ ...p, [name]: value }));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full">
        <CheckoutStepper currentStep={step} />

        {step === 3 ? (
          <div className="max-w-md mx-auto bg-card rounded-2xl border border-border p-10 text-center space-y-5">
            <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto"><ShieldCheck className="w-8 h-8 text-success" /></div>
            <h1 className="text-2xl font-black text-foreground">Compra Simulada Exitosa</h1>
            <p className="text-sm text-muted-foreground">Tus boletos fueron emitidos en el entorno de demo. No se realizó ningún cargo real.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link to={completedOrderId ? `/confirmacion?orderId=${completedOrderId}` : "/confirmacion"} className="flex-1 py-3 bg-primary text-primary-foreground font-bold rounded-lg text-center text-sm hover:bg-primary/90 transition-colors">Ver Confirmación</Link>
              <Link to="/" className="flex-1 py-3 bg-secondary text-secondary-foreground font-bold rounded-lg text-center text-sm hover:bg-secondary/80 transition-colors">Seguir Comprando</Link>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 space-y-5">
              {step === 1 && (
                <>
                  <h2 className="font-black text-foreground uppercase tracking-tight">Datos del Comprador</h2>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Nombre completo" name="name" placeholder="Juan Pérez" value={form.name} onChange={handleFieldChange} error={errors.name} />
                    <Field label="Correo electrónico" name="email" type="email" placeholder="juan@email.com" value={form.email} onChange={handleFieldChange} error={errors.email} />
                    <Field label="Teléfono" name="phone" type="tel" placeholder="3001234567" value={form.phone} onChange={handleFieldChange} error={errors.phone} />
                    <div>
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Documento</label>
                      <div className="flex gap-2">
                        <select value={form.docType} onChange={(e) => setForm((p) => ({ ...p, docType: e.target.value }))} className="py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none">
                          <option value="CC">CC</option><option value="CE">CE</option><option value="PA">Pasaporte</option>
                        </select>
                        <input value={form.document} onChange={(e) => setForm((p) => ({ ...p, document: e.target.value }))} placeholder="1020304050"
                          className={`flex-1 py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${errors.document ? "ring-2 ring-destructive" : ""}`} />
                      </div>
                      {errors.document && <p className="text-xs text-destructive mt-1">{errors.document}</p>}
                    </div>
                  </div>
                </>
              )}
              {step === 2 && (
                <>
                  <h2 className="font-black text-foreground uppercase tracking-tight">Pago Simulado</h2>
                  <div className="space-y-3">
                    {[{ id: "card", label: "Tarjeta demo" }, { id: "pse", label: "PSE demo" }, { id: "nequi", label: "Nequi demo" }].map((m) => (
                      <label key={m.id} className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${form.payMethod === m.id ? "border-primary bg-primary/5" : "border-border"}`}>
                        <input type="radio" name="pay" value={m.id} checked={form.payMethod === m.id} onChange={() => setForm((p) => ({ ...p, payMethod: m.id }))} className="accent-primary" />
                        <span className="text-sm font-medium text-foreground">{m.label}</span>
                      </label>
                    ))}
                  </div>
                  {form.payMethod === "card" && (
                    <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2.5"><CreditCard className="w-4 h-4 text-primary" /><span className="text-sm text-foreground font-medium">•••• •••• •••• 4242</span></div>
                      <p className="text-xs text-muted-foreground">Pago simulado. No se contacta una pasarela fiat ni se realiza ningún cargo real.</p>
                    </div>
                  )}
                  <label className={`flex items-start gap-2 mt-4 ${errors.terms ? "text-destructive" : ""}`}>
                    <input type="checkbox" checked={form.terms} onChange={(e) => setForm((p) => ({ ...p, terms: e.target.checked }))} className="accent-primary mt-1" />
                    <span className="text-xs text-muted-foreground">
                      Acepto los <span className="text-primary font-medium">términos y condiciones</span> y la <span className="text-primary font-medium">política de privacidad</span> de la demo.
                    </span>
                  </label>
                  {errors.terms && <p className="text-xs text-destructive">{errors.terms}</p>}
                </>
              )}
              <div className="flex gap-3 pt-4">
                {step > 1 && <button disabled={isSubmitting} onClick={() => setStep(step - 1)} className="px-6 py-3 bg-secondary text-secondary-foreground font-bold rounded-lg text-sm hover:bg-secondary/80 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">Anterior</button>}
                <button disabled={isSubmitting} onClick={handleNext} className="flex-1 py-3 bg-accent hover:bg-accent/90 disabled:opacity-70 disabled:cursor-wait text-accent-foreground font-black rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? "Confirmando..." : step === 2 ? `Confirmar compra simulada — $${total.toLocaleString("es-CO")}` : "Continuar"}
                </button>
              </div>
              {submitError && (
                <p role="alert" className="text-sm font-semibold text-destructive">
                  {submitError}
                </p>
              )}
            </div>
            <div className="bg-card rounded-xl border border-border p-6 space-y-4 h-fit sticky top-24">
              <h3 className="font-black text-foreground uppercase tracking-tight text-sm">Resumen de Orden</h3>
              {cart.map((c) => (
                <div key={c.id} className="flex justify-between text-xs"><span className="text-muted-foreground">{c.ticketType.name} ×{c.quantity}</span><span className="font-bold text-foreground">${(c.ticketType.price * c.quantity).toLocaleString("es-CO")}</span></div>
              ))}
              <hr className="border-border" />
              <div className="flex justify-between text-xs text-muted-foreground"><span>Subtotal</span><span className="text-foreground font-bold">${subtotal.toLocaleString("es-CO")}</span></div>
              <div className="flex justify-between text-xs text-muted-foreground"><span>Servicio</span><span className="text-foreground font-bold">${fees.toLocaleString("es-CO")}</span></div>
              <hr className="border-border" />
              <div className="flex justify-between font-black text-foreground"><span>Total</span><span>${total.toLocaleString("es-CO")}</span></div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Checkout;
