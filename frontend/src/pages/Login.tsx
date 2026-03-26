import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext } from "@/context/AppContext";

const Login = () => {
  const { login } = useAppContext();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { setError("Email inválido"); return; }
    if (password.length < 4) { setError("Contraseña muy corta"); return; }
    try {
      setError("");
      setIsSubmitting(true);
      await login(email, password);
      navigate("/mi-cuenta");
    } catch {
      setError("No fue posible iniciar sesión");
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
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center mx-auto mb-3"><span className="text-primary-foreground font-black">TT</span></div>
            <h1 className="text-2xl font-black text-foreground">Iniciar Sesión</h1>
            <p className="text-sm text-muted-foreground mt-1">Accede a tu cuenta TuTicket</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Correo electrónico</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Contraseña</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button disabled={isSubmitting} type="submit" className="w-full py-3 bg-accent hover:bg-accent/90 text-accent-foreground font-black rounded-lg text-sm transition-colors disabled:opacity-60">{isSubmitting ? "Ingresando..." : "Ingresar"}</button>
          </form>
          <p className="text-center text-sm text-muted-foreground">¿No tienes cuenta? <Link to="/registro" className="text-primary font-bold hover:underline">Regístrate</Link></p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Login;
