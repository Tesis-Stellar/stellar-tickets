import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext } from "@/context/AppContext";

const Field = ({ label, name, type = "text", ph = "", value, error, onChange }: { label: string; name: string; type?: string; ph?: string; value: string; error?: string; onChange: (name: string, value: string) => void }) => (
  <div>
    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">{label}</label>
    <input type={type} value={value} onChange={(e) => onChange(name, e.target.value)} placeholder={ph}
      className={`w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "ring-2 ring-destructive" : ""}`} />
    {error && <p className="text-xs text-destructive mt-1">{error}</p>}
  </div>
);

const Register = () => {
  const { register } = useAppContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", document: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (name: string, value: string) => setForm((p) => ({ ...p, [name]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Requerido";
    if (!form.email.includes("@")) errs.email = "Email inválido";
    if (form.phone.length < 7) errs.phone = "Teléfono inválido";
    if (form.document.length < 5) errs.document = "Documento inválido";
    if (form.password.length < 6) errs.password = "Mínimo 6 caracteres";
    if (form.password !== form.confirm) errs.confirm = "No coinciden";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      setIsSubmitting(true);
      await register({ name: form.name, email: form.email, phone: form.phone, document: form.document, password: form.password });
      navigate("/mi-cuenta");
    } catch {
      setErrors({ submit: "No se pudo crear la cuenta" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-card rounded-2xl border border-border p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-black text-foreground">Crear Cuenta</h1>
            <p className="text-sm text-muted-foreground mt-1">Unete a TuTicket</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Nombre completo" name="name" ph="Juan Pérez" value={form.name} error={errors.name} onChange={handleChange} />
            <Field label="Correo electrónico" name="email" type="email" ph="tu@email.com" value={form.email} error={errors.email} onChange={handleChange} />
            <Field label="Teléfono" name="phone" type="tel" ph="3001234567" value={form.phone} error={errors.phone} onChange={handleChange} />
            <Field label="Documento de identidad" name="document" ph="1020304050" value={form.document} error={errors.document} onChange={handleChange} />
            <Field label="Contraseña" name="password" type="password" ph="••••••••" value={form.password} error={errors.password} onChange={handleChange} />
            <Field label="Confirmar contraseña" name="confirm" type="password" ph="••••••••" value={form.confirm} error={errors.confirm} onChange={handleChange} />
            {errors.submit && <p className="text-xs text-destructive">{errors.submit}</p>}
            <button disabled={isSubmitting} type="submit" className="w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg text-sm transition-colors disabled:opacity-60">{isSubmitting ? "Creando..." : "Registrarse"}</button>
          </form>
          <p className="text-center text-sm text-muted-foreground">¿Ya tienes cuenta? <Link to="/login" className="text-primary font-bold hover:underline">Ingresar</Link></p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Register;
