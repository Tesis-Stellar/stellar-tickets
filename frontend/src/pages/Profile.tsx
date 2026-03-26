import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";

const Profile = () => {
  const { isLoggedIn, user, updateProfile } = useAppContext();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", document: user?.document ?? "" });

  if (!isLoggedIn) return <Navigate to="/login" replace />;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateProfile(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaved(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Mi Perfil</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3">
            <form onSubmit={handleSave} className="bg-card rounded-xl border border-border p-6 space-y-4 max-w-lg">
              {[
                { label: "Nombre completo", name: "name" },
                { label: "Correo electrónico", name: "email", type: "email" },
                { label: "Teléfono", name: "phone", type: "tel" },
                { label: "Documento", name: "document" },
              ].map((f) => (
                <div key={f.name}>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">{f.label}</label>
                  <input type={f.type ?? "text"} value={(form as any)[f.name]} onChange={(e) => setForm((p) => ({ ...p, [f.name]: e.target.value }))}
                    className="w-full py-2.5 px-3 bg-secondary rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              ))}
              <button type="submit" className="py-3 px-6 bg-primary text-primary-foreground font-bold rounded-lg text-sm hover:bg-primary/90 transition-colors">Guardar Cambios</button>
              {saved && <p className="text-sm text-success font-bold">✓ Perfil actualizado</p>}
            </form>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Profile;
