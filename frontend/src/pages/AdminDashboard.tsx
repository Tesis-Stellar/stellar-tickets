import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext } from "@/context/AppContext";
import { ShieldCheck, Plus, RefreshCw, Rocket, Building, MapPin, Users, Ticket, ExternalLink, Image as ImageIcon, X, MessageSquareText, SlidersHorizontal, Settings, LogOut, QrCode, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

interface AdminEvent {
  id: string;
  title: string;
  slug: string;
  contract_address: string | null;
  startsAt: string;
  status: string;
  venue: { name: string };
  city: string;
}

interface VenueSection {
  id: string;
  name: string;
  capacity: number;
}

interface Venue {
  id: string;
  name: string;
  type: string;
  address: string;
  sections: VenueSection[];
}

interface AdminContractList {
  factoryContractId: string;
  events: { id: string; title: string; contract_address: string; created_at: string }[];
}

interface AdminClaim {
  id: string;
  type: string;
  status: string;
  subject: string;
  description: string;
  createdAt: string;
  user: { name: string; email: string } | null;
}

interface AdminResalePolicy {
  eventId: string;
  enabled: boolean;
  limitType: "FIXED_PRICE" | "PERCENTAGE";
  maxPriceAmount: number | null;
  maxPricePercent: number | null;
  resaleStartsAt: string | null;
  resaleEndsAt: string | null;
  blockHoursBeforeEvent: number;
  platformFeePercent: number;
  organizerFeePercent: number;
}

type ResalePolicyForm = {
  enabled: boolean;
  limitType: "FIXED_PRICE" | "PERCENTAGE";
  maxPriceAmount: string;
  maxPricePercent: string;
  resaleStartsAt: string;
  resaleEndsAt: string;
  blockHoursBeforeEvent: string;
  platformFeePercent: string;
  organizerFeePercent: string;
};

type AdminSection = "panel" | "events" | "policies" | "claims" | "contracts" | "scanner" | "profile";

const defaultPolicyForm: ResalePolicyForm = {
  enabled: true,
  limitType: "PERCENTAGE",
  maxPriceAmount: "",
  maxPricePercent: "150",
  resaleStartsAt: "",
  resaleEndsAt: "",
  blockHoursBeforeEvent: "6",
  platformFeePercent: "3",
  organizerFeePercent: "5",
};

const toDatetimeLocal = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const policyToForm = (policy: AdminResalePolicy): ResalePolicyForm => ({
  enabled: policy.enabled,
  limitType: policy.limitType,
  maxPriceAmount: policy.maxPriceAmount != null ? String(policy.maxPriceAmount) : "",
  maxPricePercent: policy.maxPricePercent != null ? String(policy.maxPricePercent) : "",
  resaleStartsAt: toDatetimeLocal(policy.resaleStartsAt),
  resaleEndsAt: toDatetimeLocal(policy.resaleEndsAt),
  blockHoursBeforeEvent: String(policy.blockHoursBeforeEvent),
  platformFeePercent: String(policy.platformFeePercent),
  organizerFeePercent: String(policy.organizerFeePercent),
});

const AdminDashboard = () => {
  const { user, authStatus, apiFetch, logout } = useAppContext();
  const navigate = useNavigate();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [claims, setClaims] = useState<AdminClaim[]>([]);
  const [contractsData, setContractsData] = useState<AdminContractList | null>(null);
  const [loading, setLoading] = useState(true);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [eventsPage, setEventsPage] = useState(1);
  const [showMasterAccount, setShowMasterAccount] = useState(false);
  
  // Interactive Form State
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [activeSections, setActiveSections] = useState<Record<string, boolean>>({});
  const [sectionConfig, setSectionConfig] = useState<Record<string, { price: number; capacity: number }>>({});
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverImageName, setCoverImageName] = useState<string>("");
  const [claimResponses, setClaimResponses] = useState<Record<string, string>>({});
  const [policyEventId, setPolicyEventId] = useState("");
  const [policyForm, setPolicyForm] = useState<ResalePolicyForm>(defaultPolicyForm);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("panel");
  
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsData, venuesData, contractsRes] = await Promise.all([
        apiFetch<AdminEvent[]>("/api/admin/events"),
        apiFetch<Venue[]>("/api/admin/venues"),
        apiFetch<AdminContractList>("/api/admin/contracts")
      ]);
      const claimsData = await apiFetch<AdminClaim[]>("/api/admin/claims").catch(() => []);
      setEvents(eventsData || []);
      setVenues(venuesData || []);
      setClaims(claimsData || []);
      setContractsData(contractsRes || null);
    } catch (err: unknown) {
      toast({ title: "Error", description: getErrorMessage(err, "No fue posible cargar datos"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, toast]);

  useEffect(() => {
    if (authStatus === "checking") return;
    if (!user || user.role !== "ADMIN") {
      navigate("/");
      return;
    }
    loadData();
  }, [authStatus, user, navigate, loadData]);

  const handleVenueChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const venueId = e.target.value;
    setSelectedVenueId(venueId);
    
    // Reset selections for new venue
    const venue = venues.find(v => v.id === venueId);
    const defaults: Record<string, boolean> = {};
    const configDefaults: Record<string, { price: number; capacity: number }> = {};
    
    if (venue) {
      venue.sections.forEach(s => {
        defaults[s.id] = false;
        configDefaults[s.id] = { price: 150000, capacity: s.capacity };
      });
    }
    setActiveSections(defaults);
    setSectionConfig(configDefaults);
  };

  const toggleSection = (sectionId: string) => {
    setActiveSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const updateSectionConfig = (sectionId: string, field: "price" | "capacity", value: number) => {
    setSectionConfig(prev => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [field]: value }
    }));
  };

  const handleCoverImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Archivo inválido", description: "Selecciona una imagen PNG, JPG o WEBP.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagen muy grande", description: "Máximo 5 MB. Comprime la imagen e intenta de nuevo.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCoverImage(typeof reader.result === "string" ? reader.result : null);
      setCoverImageName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const clearCoverImage = () => {
    setCoverImage(null);
    setCoverImageName("");
  };

  // Compute metrics
  const selectedVenue = venues.find(v => v.id === selectedVenueId);
  const totalVenueCapacity = selectedVenue ? selectedVenue.sections.reduce((sum, s) => sum + s.capacity, 0) : 0;
  const activeCapacity = selectedVenue ? selectedVenue.sections.filter(s => activeSections[s.id]).reduce((sum, s) => sum + (sectionConfig[s.id]?.capacity || 0), 0) : 0;
  const capacityPercent = totalVenueCapacity ? Math.round((activeCapacity / totalVenueCapacity) * 100) : 0;
  const eventsPageSize = 3;
  const eventsTotalPages = Math.max(1, Math.ceil(events.length / eventsPageSize));
  const normalizedEventsPage = Math.min(eventsPage, eventsTotalPages);
  const paginatedEvents = events.slice((normalizedEventsPage - 1) * eventsPageSize, normalizedEventsPage * eventsPageSize);
  const visibleEventPages = Array.from({ length: eventsTotalPages }, (_, idx) => idx + 1).filter((page) => {
    if (eventsTotalPages <= 7) return true;
    if (page === 1 || page === eventsTotalPages) return true;
    return Math.abs(page - normalizedEventsPage) <= 1;
  });
  const deployedContractsCount = contractsData?.events.length ?? events.filter((event) => event.contract_address).length;
  const pendingDeployCount = events.filter((event) => !event.contract_address).length;

  const adminSections: { id: AdminSection; label: string; icon: typeof Settings }[] = [
    { id: "panel", label: "Panel", icon: Settings },
    { id: "events", label: "Eventos", icon: Plus },
    { id: "policies", label: "Reglas Secure Ticket", icon: SlidersHorizontal },
    { id: "claims", label: "PQR y Reclamos", icon: MessageSquareText },
    { id: "contracts", label: "Contratos Secure Ticket", icon: ShieldCheck },
    { id: "scanner", label: "Secure Ticket Scanner", icon: QrCode },
    { id: "profile", label: "Perfil", icon: Users },
  ];

  const adminCards: { id: AdminSection; icon: typeof Settings; label: string; value: string }[] = [
    { id: "events", icon: Building, label: "Eventos", value: `${events.length} registrado${events.length !== 1 ? "s" : ""}` },
    { id: "contracts", icon: ShieldCheck, label: "Secure Ticket", value: `${deployedContractsCount} contrato${deployedContractsCount !== 1 ? "s" : ""}` },
    { id: "policies", icon: SlidersHorizontal, label: "Reglas Secure Ticket", value: "Control P2P" },
    { id: "claims", icon: MessageSquareText, label: "PQR y Reclamos", value: `${claims.length} caso${claims.length !== 1 ? "s" : ""}` },
    { id: "scanner", icon: QrCode, label: "Secure Ticket Scanner", value: "Validación en puerta" },
    { id: "events", icon: Rocket, label: "Pendientes de Deploy", value: `${pendingDeployCount} evento${pendingDeployCount !== 1 ? "s" : ""}` },
  ];

  useEffect(() => {
    if (eventsPage > eventsTotalPages) setEventsPage(eventsTotalPages);
  }, [eventsPage, eventsTotalPages]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedVenue) {
      toast({ title: "Atención", description: "Selecciona un recinto primero.", variant: "destructive" });
      return;
    }

    const enabledSections = selectedVenue.sections
      .filter(s => activeSections[s.id])
      .map(s => ({
        id: s.id,
        name: s.name,
        price: sectionConfig[s.id].price,
        capacity: sectionConfig[s.id].capacity
      }));

    if (enabledSections.length === 0) {
      toast({ title: "Error", description: "Debes habilitar al menos una localidad del estadio.", variant: "destructive" });
      return;
    }

    const formData = new FormData(e.currentTarget);
    const payload = {
      title: formData.get("title"),
      slug: formData.get("slug"),
      date: formData.get("date"),
      venue_id: selectedVenue.id,
      sections: enabledSections,
      cover_image_url: coverImage,
    };

    try {
      await apiFetch("/api/admin/events", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast({ title: "¡Evento Creado!", description: "Se ha registrado el evento de forma exitosa en Supabase." });
      loadData();
      (e.target as HTMLFormElement).reset();
      setSelectedVenueId("");
      clearCoverImage();
    } catch (err: unknown) {
      toast({ title: "Error al crear", description: getErrorMessage(err, "No fue posible crear el evento"), variant: "destructive" });
    }
  };

  const deployContract = async (id: string) => {
    setDeployingId(id);
    try {
      const res = await apiFetch<{ success?: boolean; contractAddress?: string }>(`/api/admin/events/${id}/deploy`, { method: "POST" });
      if (res?.success) {
        toast({ title: "Deploy On-Chain Exitoso", description: `Contrato: ${res.contractAddress?.slice(0,8) ?? ""}...` });
        loadData();
      }
    } catch (err: unknown) {
      toast({ title: "Fallo el Despliegue", description: getErrorMessage(err, "No fue posible desplegar el contrato"), variant: "destructive" });
    } finally {
      setDeployingId(null);
    }
  };

  const updateClaim = async (claimId: string, status: string) => {
    try {
      await apiFetch(`/api/admin/claims/${claimId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          message: claimResponses[claimId] || undefined,
          decisionReason: ["RESOLVED", "REJECTED"].includes(status) ? claimResponses[claimId] || "Revisado por soporte" : undefined,
        }),
      });
      setClaimResponses((prev) => ({ ...prev, [claimId]: "" }));
      toast({ title: "Reclamo actualizado", description: "La bitácora quedó registrada." });
      loadData();
    } catch (err: unknown) {
      toast({ title: "Error actualizando reclamo", description: getErrorMessage(err, "No fue posible actualizar el reclamo"), variant: "destructive" });
    }
  };

  const loadResalePolicy = async (eventId: string) => {
    setPolicyEventId(eventId);
    if (!eventId) {
      setPolicyForm(defaultPolicyForm);
      return;
    }
    setPolicyLoading(true);
    try {
      const policy = await apiFetch<AdminResalePolicy>(`/api/admin/events/${eventId}/resale-policy`);
      setPolicyForm(policyToForm(policy));
    } catch (err: unknown) {
      toast({ title: "No se pudieron consultar las reglas", description: getErrorMessage(err, "Intenta nuevamente."), variant: "destructive" });
    } finally {
      setPolicyLoading(false);
    }
  };

  const updatePolicyField = <K extends keyof ResalePolicyForm>(field: K, value: ResalePolicyForm[K]) => {
    setPolicyForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveResalePolicy = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!policyEventId) {
      toast({ title: "Selecciona un evento", description: "Debes escoger el evento antes de guardar reglas.", variant: "destructive" });
      return;
    }
    setPolicySaving(true);
    try {
      const payload = {
        enabled: policyForm.enabled,
        limitType: policyForm.limitType,
        maxPriceAmount: policyForm.limitType === "FIXED_PRICE" ? Number(policyForm.maxPriceAmount) : null,
        maxPricePercent: policyForm.limitType === "PERCENTAGE" ? Number(policyForm.maxPricePercent) : null,
        resaleStartsAt: policyForm.resaleStartsAt || null,
        resaleEndsAt: policyForm.resaleEndsAt || null,
        blockHoursBeforeEvent: Number(policyForm.blockHoursBeforeEvent),
        platformFeePercent: Number(policyForm.platformFeePercent),
        organizerFeePercent: Number(policyForm.organizerFeePercent),
      };
      const saved = await apiFetch<AdminResalePolicy>(`/api/admin/events/${policyEventId}/resale-policy`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setPolicyForm(policyToForm(saved));
      toast({ title: "Reglas de reventa guardadas", description: "Los usuarios verán estos límites antes de listar sus boletos." });
    } catch (err: unknown) {
      toast({ title: "No se pudo guardar la política", description: getErrorMessage(err, "Revisa los valores e intenta de nuevo."), variant: "destructive" });
    } finally {
      setPolicySaving(false);
    }
  };

  if (authStatus === "checking") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm font-bold text-muted-foreground">Cargando sesión...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 md:py-12 w-full space-y-8">
        
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" /> Secure Ticket Console
          </h1>
          <p className="text-muted-foreground text-sm">Capa operativa de confianza para TuTicket: contratos, reglas de reventa, scanner y evidencia.</p>
        </div>

        <div className="grid lg:grid-cols-4 gap-6">
          <aside className="bg-card rounded-xl border border-border p-4 space-y-1 h-fit">
            {adminSections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors w-full text-left ${
                  activeSection === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
            <button
              onClick={logout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors w-full"
            >
              <LogOut className="w-4 h-4" />
              Cerrar Sesión
            </button>
          </aside>

          <div className="lg:col-span-3 space-y-6">
            {activeSection === "panel" && (
              <section className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Bienvenido, <span className="font-bold text-foreground">{user?.name}</span>
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  {adminCards.map((card) => (
                    <button
                      key={`${card.id}-${card.label}`}
                      type="button"
                      onClick={() => setActiveSection(card.id)}
                      className="bg-card rounded-xl border border-border p-6 hover:border-primary/30 transition-colors group text-left"
                    >
                      <card.icon className="w-8 h-8 text-primary mb-3" />
                      <p className="font-bold text-foreground group-hover:text-primary transition-colors">{card.label}</p>
                      <p className="text-sm text-muted-foreground">{card.value}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {activeSection === "events" && (
        <div className="grid md:grid-cols-2 gap-8">
          
          {/* CREATE FORM */}
          <div className="bg-card rounded-xl p-6 border border-border shadow-sm h-fit">
            <h2 className="text-lg font-bold flex items-center gap-2 mb-6 uppercase tracking-tight">
              <Plus className="w-5 h-5 text-primary" /> Nuevo Evento (Aforo Interactivo)
            </h2>
            <form onSubmit={handleCreate} className="space-y-6">
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase">Título del Evento</label>
                  <input required name="title" className="w-full bg-background border border-border p-2.5 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-primary/20 outline-none" placeholder="El Festival del Año"/>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase">Slug (URL)</label>
                    <input required name="slug" className="w-full bg-background border border-border p-2.5 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-primary/20 outline-none" placeholder="el-festival-2026"/>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase">Fecha / Hora</label>
                    <input required type="datetime-local" name="date" className="w-full bg-background border border-border p-2.5 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-primary/20 outline-none"/>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> Imagen del Evento
                  </label>
                  {coverImage ? (
                    <div className="mt-1 relative rounded-lg overflow-hidden border border-border bg-background">
                      <img src={coverImage} alt="Preview del evento" className="w-full h-40 object-cover" />
                      <button
                        type="button"
                        onClick={clearCoverImage}
                        className="absolute top-2 right-2 bg-background/90 hover:bg-destructive hover:text-destructive-foreground border border-border rounded-full p-1.5 shadow-md transition-colors"
                        aria-label="Quitar imagen"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground truncate border-t border-border">
                        {coverImageName}
                      </div>
                    </div>
                  ) : (
                    <label className="mt-1 flex flex-col items-center justify-center gap-1.5 w-full h-28 bg-background border-2 border-dashed border-border hover:border-primary/40 rounded-lg cursor-pointer transition-colors text-muted-foreground hover:text-foreground">
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-xs font-medium">Subir imagen PNG, JPG o WEBP</span>
                      <span className="text-[10px] opacity-70">Máx. 5 MB · Opcional</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCoverImageChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {/* VENUE SELECTION */}
                <div className="pt-2 border-t border-border">
                  <label className="text-xs font-bold text-muted-foreground flex items-center gap-1 uppercase mb-2">
                    <Building className="w-3 h-3" /> Estadio / Recinto
                  </label>
                  <select 
                    required 
                    value={selectedVenueId} 
                    onChange={handleVenueChange}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="" disabled>-- Selecciona un estadio precargado --</option>
                    {venues.map(v => (
                      <option key={v.id} value={v.id}>{v.name} ({v.type})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* DYNAMIC STADIUM BUILDER */}
              {selectedVenue && (
                <div className="bg-accent/5 -mx-6 p-6 border-y border-border space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-black text-foreground flex items-center gap-1.5"><MapPin className="w-4 h-4 text-primary" /> {selectedVenue.name}</h3>
                      <p className="text-xs text-muted-foreground">Configura las Graderías y Cuotas</p>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-muted-foreground">Aforo Configurado</div>
                      <div className={`text-xl font-black ${capacityPercent === 100 ? 'text-success' : 'text-primary'}`}>{activeCapacity.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ {totalVenueCapacity.toLocaleString()}</span></div>
                    </div>
                  </div>

                  {/* PROGRESS BAR */}
                  <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border">
                    <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${capacityPercent}%` }} />
                  </div>

                  {/* SECTIONS */}
                  <div className="space-y-2 mt-4 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                    {selectedVenue.sections.map(s => (
                      <div key={s.id} className={`p-3 rounded-xl border transition-all ${activeSections[s.id] ? 'bg-background border-primary/30 shadow-sm' : 'bg-background/50 border-border opacity-70'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={activeSections[s.id]} 
                              onChange={() => toggleSection(s.id)}
                              className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <span className="font-bold text-sm">{s.name}</span>
                          </label>
                          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1"><Users className="w-3 h-3"/> Máx: {s.capacity}</span>
                        </div>
                        
                        {activeSections[s.id] && (
                          <div className="flex gap-2 pt-2 border-t border-border mt-2 animate-in slide-in-from-top-1">
                            <div className="flex-1">
                              <label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1"><Ticket className="w-3 h-3"/> Cuota / Emisión</label>
                              <input 
                                type="number" 
                                min={1}
                                max={s.capacity}
                                value={sectionConfig[s.id]?.capacity} 
                                onChange={(e) => updateSectionConfig(s.id, 'capacity', Number(e.target.value))}
                                className="w-full bg-accent/10 border-none p-1.5 rounded text-sm mt-1"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-[10px] uppercase font-bold text-muted-foreground">Precio Pesos (COP)</label>
                              <input 
                                type="number" 
                                min={0}
                                value={sectionConfig[s.id]?.price} 
                                onChange={(e) => updateSectionConfig(s.id, 'price', Number(e.target.value))}
                                className="w-full bg-accent/10 border-none p-1.5 rounded text-sm mt-1 font-mono"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" disabled={!selectedVenue || activeCapacity === 0} className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-black py-3 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2">
                <Plus className="w-5 h-5" /> Registrar Evento Híbrido
              </button>
            </form>
          </div>

          {/* EVENTS LIST ROW */}
          <div className="bg-card rounded-xl p-5 border border-border shadow-sm overflow-hidden flex flex-col h-full">
            <div className="flex justify-between items-start gap-4 mb-4">
               <div>
                 <h2 className="text-base font-black flex items-center gap-2 uppercase tracking-tight">Directorio Híbrido</h2>
                 <p className="text-xs text-muted-foreground mt-1">
                   {events.length} evento{events.length !== 1 ? "s" : ""} · página {normalizedEventsPage} de {eventsTotalPages}
                 </p>
               </div>
               <button onClick={loadData} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-secondary">
                 <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
               </button>
            </div>
            
            <div className="flex-1 space-y-2.5">
                {paginatedEvents.map(e => (
                  <div key={e.id} className="p-3 rounded-lg border border-border bg-background hover:border-primary/20 transition-colors">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <div className="font-black text-sm text-foreground leading-snug truncate">{e.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{new Date(e.startsAt).toLocaleDateString()} — {e.venue.name}</div>
                      </div>
                      <div className="shrink-0 text-[9px] uppercase font-mono bg-accent text-accent-foreground px-1.5 py-0.5 rounded font-black">
                        {e.city}
                      </div>
                    </div>
                    
                    <div className="pt-2 mt-2 border-t border-border flex items-center justify-between">
                      {e.contract_address ? (
                         <div className="bg-success/10 border border-success/20 text-success text-[11px] font-black px-2.5 py-1.5 rounded-md flex items-center gap-1.5 w-full justify-center">
                           <span>ON-CHAIN ✓</span>
                           <a target="_blank" rel="noreferrer" href={`https://testnet.stellarchain.io/contracts/${e.contract_address}`} className="font-mono underline hover:text-success/80 ml-2">
                             {e.contract_address.slice(0,8)}...{e.contract_address.slice(-6)}
                           </a>
                         </div>
                      ) : (
                         <button 
                           onClick={() => deployContract(e.id)} 
                           disabled={deployingId === e.id}
                           className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-black text-[11px] py-1.5 rounded-md shadow-sm transition-all"
                         >
                           <Rocket className={`w-3.5 h-3.5 ${deployingId === e.id ? 'animate-bounce' : ''}`} /> 
                           {deployingId === e.id ? 'Desplegando en Soroban...' : 'Desplegar Contrato / Init'}
                         </button>
                      )}
                    </div>
                  </div>
                ))}
                {events.length === 0 && !loading && (
                  <div className="text-center py-12 text-muted-foreground flex flex-col items-center">
                    <Building className="w-12 h-12 mb-3 opacity-20" />
                    No hay eventos registrados
                  </div>
                )}
            </div>
            {events.length > eventsPageSize && (
              <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setEventsPage((page) => Math.max(1, page - 1))}
                  disabled={normalizedEventsPage === 1}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Anterior
                </button>
                <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden">
                  {visibleEventPages.map((page, index) => {
                    const previousPage = visibleEventPages[index - 1];
                    const showGap = previousPage !== undefined && page - previousPage > 1;
                    return (
                      <div key={page} className="flex items-center gap-1">
                        {showGap && <span className="px-0.5 text-xs font-black text-muted-foreground">…</span>}
                        <button
                          type="button"
                          onClick={() => setEventsPage(page)}
                          className={`h-7 min-w-7 rounded-lg px-2 text-[11px] font-black transition-colors ${
                            page === normalizedEventsPage
                              ? "bg-primary text-primary-foreground"
                              : "bg-background text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          {page}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setEventsPage((page) => Math.min(eventsTotalPages, page + 1))}
                  disabled={normalizedEventsPage === eventsTotalPages}
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Siguiente
                </button>
              </div>
            )}
          </div>

        </div>
            )}

          {activeSection === "policies" && (
          <section className="bg-card rounded-xl p-6 border border-border shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-tight">
                  <SlidersHorizontal className="w-5 h-5 text-primary" /> Políticas de Reventa
                </h2>
                <p className="text-xs text-muted-foreground mt-1">Configura límites por evento para controlar la reventa P2P.</p>
              </div>
              {policyLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>

            <form onSubmit={saveResalePolicy} className="space-y-5">
              <div className="grid md:grid-cols-[1.5fr_0.7fr_0.8fr] gap-4">
                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Evento</span>
                  <select
                    value={policyEventId}
                    onChange={(e) => loadResalePolicy(e.target.value)}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  >
                    <option value="">Selecciona un evento</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>{event.title}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Estado</span>
                  <select
                    value={policyForm.enabled ? "true" : "false"}
                    onChange={(e) => updatePolicyField("enabled", e.target.value === "true")}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  >
                    <option value="true">Reventa habilitada</option>
                    <option value="false">Reventa deshabilitada</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Tipo de límite</span>
                  <select
                    value={policyForm.limitType}
                    onChange={(e) => updatePolicyField("limitType", e.target.value as ResalePolicyForm["limitType"])}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  >
                    <option value="PERCENTAGE">Porcentaje</option>
                    <option value="FIXED_PRICE">Precio fijo</option>
                  </select>
                </label>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                {policyForm.limitType === "FIXED_PRICE" ? (
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-muted-foreground uppercase">Precio máximo fijo (COP)</span>
                    <input
                      type="number"
                      min={1}
                      value={policyForm.maxPriceAmount}
                      onChange={(e) => updatePolicyField("maxPriceAmount", e.target.value)}
                      disabled={!policyEventId || policyLoading}
                      className="w-full bg-background border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                    />
                  </label>
                ) : (
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-muted-foreground uppercase">Máximo sobre precio original (%)</span>
                    <input
                      type="number"
                      min={1}
                      value={policyForm.maxPricePercent}
                      onChange={(e) => updatePolicyField("maxPricePercent", e.target.value)}
                      disabled={!policyEventId || policyLoading}
                      className="w-full bg-background border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                    />
                  </label>
                )}

                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Comisión plataforma (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={policyForm.platformFeePercent}
                    onChange={(e) => updatePolicyField("platformFeePercent", e.target.value)}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Comisión organizador (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.1"
                    value={policyForm.organizerFeePercent}
                    onChange={(e) => updatePolicyField("organizerFeePercent", e.target.value)}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Inicio de ventana</span>
                  <input
                    type="datetime-local"
                    value={policyForm.resaleStartsAt}
                    onChange={(e) => updatePolicyField("resaleStartsAt", e.target.value)}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Fin de ventana</span>
                  <input
                    type="datetime-local"
                    value={policyForm.resaleEndsAt}
                    onChange={(e) => updatePolicyField("resaleEndsAt", e.target.value)}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Bloqueo antes del evento (h)</span>
                  <input
                    type="number"
                    min={0}
                    max={720}
                    value={policyForm.blockHoursBeforeEvent}
                    onChange={(e) => updatePolicyField("blockHoursBeforeEvent", e.target.value)}
                    disabled={!policyEventId || policyLoading}
                    className="w-full bg-background border border-border p-2.5 rounded-lg text-sm font-mono focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Vendedor recibe {Math.max(0, 100 - Number(policyForm.platformFeePercent || 0) - Number(policyForm.organizerFeePercent || 0)).toFixed(1)}% después de comisiones.
                </p>
                <button
                  type="submit"
                  disabled={!policyEventId || policyLoading || policySaving}
                  className="rounded-lg bg-primary px-4 py-2 text-xs font-black text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {policySaving ? "Guardando..." : "Guardar reglas"}
                </button>
              </div>
            </form>
          </section>
          )}

          {activeSection === "claims" && (
          <section className="bg-card rounded-xl p-6 border border-border shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-tight">
                <MessageSquareText className="w-5 h-5 text-primary" /> PQR y Reclamos
              </h2>
              <span className="text-xs font-bold text-muted-foreground">{claims.length} caso{claims.length !== 1 ? "s" : ""}</span>
            </div>
            {claims.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay reclamos registrados.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {claims.slice(0, 6).map((claim) => (
                  <article key={claim.id} className="rounded-xl border border-border bg-background p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-black text-sm text-foreground">{claim.subject}</h3>
                        <p className="text-xs text-muted-foreground">{claim.user?.email ?? "Usuario"} · {new Date(claim.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">{claim.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{claim.description}</p>
                    <textarea
                      value={claimResponses[claim.id] ?? ""}
                      onChange={(e) => setClaimResponses((prev) => ({ ...prev, [claim.id]: e.target.value }))}
                      className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs resize-none"
                      rows={2}
                      placeholder="Respuesta o justificación interna"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => updateClaim(claim.id, "IN_REVIEW")} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">En revisión</button>
                      <button onClick={() => updateClaim(claim.id, "WAITING_USER")} className="rounded bg-amber-500 px-3 py-1.5 text-xs font-bold text-white">Pedir info</button>
                      <button onClick={() => updateClaim(claim.id, "RESOLVED")} className="rounded bg-green-600 px-3 py-1.5 text-xs font-bold text-white">Resolver</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          )}

          {activeSection === "profile" && (
            <section className="bg-card rounded-xl p-6 border border-border shadow-sm">
              <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-tight mb-4">
                <Users className="w-5 h-5 text-primary" /> Perfil
              </h2>
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div className="rounded-xl border border-border bg-background p-4">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Nombre</p>
                  <p className="font-bold text-foreground mt-1">{user?.name ?? "Administrador"}</p>
                </div>
                <div className="rounded-xl border border-border bg-background p-4">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Rol</p>
                  <p className="font-bold text-foreground mt-1">{user?.role ?? "ADMIN"}</p>
                </div>
                <div className="rounded-xl border border-border bg-background p-4 sm:col-span-2">
                  <p className="text-xs font-bold text-muted-foreground uppercase">Correo</p>
                  <p className="font-bold text-foreground mt-1">{user?.email ?? "Sin correo"}</p>
                </div>
              </div>
            </section>
          )}

          {activeSection === "scanner" && (
            <section className="bg-card rounded-xl p-6 border border-border shadow-sm">
              <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-tight mb-3">
                <QrCode className="w-5 h-5 text-primary" /> Secure Ticket Scanner
              </h2>
              <p className="text-sm text-muted-foreground mb-5">
                Acceso operativo de Secure Ticket para validar QR firmados en puerta y registrar check-ins.
              </p>
              <button
                type="button"
                onClick={() => navigate("/escanear")}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-black text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <QrCode className="w-4 h-4" /> Abrir escáner
              </button>
            </section>
          )}

          {/* CONTRACT EXPLORER */}
          {activeSection === "contracts" && contractsData && contractsData.factoryContractId && (
            <div className="md:col-span-2 bg-card rounded-xl p-6 border border-amber-500/20 shadow-sm overflow-hidden flex flex-col lg:col-span-2 mt-4">
              <h2 className="text-xl font-black flex items-center gap-2 uppercase tracking-tight text-amber-500 mb-6">
                <ShieldCheck className="w-6 h-6" /> Explorador Secure Ticket On-Chain
              </h2>
              
              <div className="mb-8 p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Building className="w-24 h-24" /></div>
                <h3 className="relative text-sm font-bold text-amber-500 uppercase flex items-center gap-1.5"><Rocket className="w-4 h-4"/> Supremo: Cuenta Maestra Organizadora</h3>
                <p className="relative text-xs text-muted-foreground mt-1 mb-3">Tu billetera administradora en Stellar. Despliega y delega permisos a todas las fábricas y eventos creados de forma descentralizada.</p>
                <div className="relative z-10 font-mono bg-background p-3 rounded-md text-sm border border-border flex items-center justify-between gap-2">
                  <span className="truncate mr-2 text-foreground/80">
                    {showMasterAccount ? contractsData.factoryContractId : `${contractsData.factoryContractId.slice(0, 8)}••••••••••••${contractsData.factoryContractId.slice(-6)}`}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowMasterAccount((value) => !value)}
                      className="text-[10px] text-muted-foreground font-bold hover:text-foreground flex items-center gap-1 bg-secondary px-2 py-1 rounded cursor-pointer"
                      aria-label={showMasterAccount ? "Ocultar cuenta maestra" : "Mostrar cuenta maestra"}
                    >
                      {showMasterAccount ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showMasterAccount ? "Ocultar" : "Mostrar"}
                    </button>
                    {showMasterAccount && (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://stellar.expert/explorer/testnet/${contractsData.factoryContractId.startsWith("C") ? "contract" : "account"}/${contractsData.factoryContractId}`}
                        className="text-[10px] text-blue-500 font-bold hover:underline flex items-center gap-1 bg-blue-500/10 px-2 py-1 rounded cursor-pointer"
                      >
                        Stellar Expert <ExternalLink className="w-3 h-3"/>
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1">
                <h3 className="text-xs font-bold uppercase mb-4 text-muted-foreground flex items-center gap-1"><Ticket className="w-4 h-4"/> Eventos derivados y anclados</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {contractsData.events.map((c) => (
                    <div key={c.id} className="p-4 border border-border rounded-xl hover:border-primary/40 transition-colors bg-accent/5 flex flex-col justify-between h-full">
                      <div>
                        <h4 className="font-black text-sm text-foreground line-clamp-2">{c.title}</h4>
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono uppercase opacity-70">Desplegado: {new Date(c.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-border flex justify-between items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground truncate" title={c.contract_address}>{c.contract_address.slice(0, 8)}...</span>
                        <a target="_blank" rel="noreferrer" href={`https://stellar.expert/explorer/testnet/contract/${c.contract_address}`} className="text-[9px] bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded-sm font-black hover:bg-primary hover:text-white transition-colors shrink-0">VISUALIZAR</a>
                      </div>
                    </div>
                  ))}
                  {contractsData.events.length === 0 && (
                    <div className="col-span-full py-8 text-center text-xs text-muted-foreground opacity-50 flex items-center justify-center border-dashed border-2 border-border/50 rounded-xl">Ningún contrato derivado aún. Interactúa con el recuadro superior.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === "contracts" && (!contractsData || !contractsData.factoryContractId) && (
            <section className="bg-card rounded-xl p-6 border border-border shadow-sm">
              <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-tight mb-3">
                <ShieldCheck className="w-5 h-5 text-primary" /> Contratos Secure Ticket
              </h2>
              <p className="text-sm text-muted-foreground">No se pudo cargar información de contratos todavía.</p>
            </section>
          )}

          </div>
        </div>

      </main>
      <Footer />
    </div>
  );
};

export default AdminDashboard;
