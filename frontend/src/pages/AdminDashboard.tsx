import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useAppContext } from "@/context/AppContext";
import { ShieldCheck, Plus, RefreshCw, Rocket, Building, MapPin, Users, Ticket, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

const AdminDashboard = () => {
  const { user, apiFetch } = useAppContext();
  const navigate = useNavigate();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [contractsData, setContractsData] = useState<AdminContractList | null>(null);
  const [loading, setLoading] = useState(true);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  
  // Interactive Form State
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [activeSections, setActiveSections] = useState<Record<string, boolean>>({});
  const [sectionConfig, setSectionConfig] = useState<Record<string, { price: number; capacity: number }>>({});
  
  const { toast } = useToast();

  const loadData = async () => {
    setLoading(true);
    try {
      const [eventsData, venuesData, contractsRes] = await Promise.all([
        apiFetch<AdminEvent[]>("/api/admin/events"),
        apiFetch<Venue[]>("/api/admin/venues"),
        apiFetch<AdminContractList>("/api/admin/contracts")
      ]);
      setEvents(eventsData || []);
      setVenues(venuesData || []);
      setContractsData(contractsRes || null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || user.role !== "ADMIN") {
      navigate("/");
      return;
    }
    loadData();
  }, [user, navigate]);

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

  // Compute metrics
  const selectedVenue = venues.find(v => v.id === selectedVenueId);
  const totalVenueCapacity = selectedVenue ? selectedVenue.sections.reduce((sum, s) => sum + s.capacity, 0) : 0;
  const activeCapacity = selectedVenue ? selectedVenue.sections.filter(s => activeSections[s.id]).reduce((sum, s) => sum + (sectionConfig[s.id]?.capacity || 0), 0) : 0;
  const capacityPercent = totalVenueCapacity ? Math.round((activeCapacity / totalVenueCapacity) * 100) : 0;

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
      sections: enabledSections
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
    } catch (err: any) {
      toast({ title: "Error al crear", description: err.message, variant: "destructive" });
    }
  };

  const deployContract = async (id: string) => {
    setDeployingId(id);
    try {
      const res = await apiFetch<any>(`/api/admin/events/${id}/deploy`, { method: "POST" });
      if (res?.success) {
        toast({ title: "Deploy On-Chain Exitoso", description: `Contrato: ${res.contractAddress.slice(0,8)}...` });
        loadData();
      }
    } catch (err: any) {
      toast({ title: "Fallo el Despliegue", description: err.message, variant: "destructive" });
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 md:py-12 w-full space-y-8">
        
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-foreground flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" /> Panel de Organización
          </h1>
          <p className="text-muted-foreground text-sm">Crea eventos fraccionando el aforo de estadios oficiales y despliega tus Smart Contracts.</p>
        </div>

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
          <div className="bg-card rounded-xl p-6 border border-border shadow-sm overflow-hidden flex flex-col h-full">
            <div className="flex justify-between items-center mb-6">
               <h2 className="text-lg font-bold flex items-center gap-2 uppercase tracking-tight">Directorio Híbrido</h2>
               <button onClick={loadData} className="text-muted-foreground hover:text-foreground">
                 <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
               </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">
                {events.map(e => (
                  <div key={e.id} className="p-4 rounded-xl border border-border bg-background hover:border-primary/20 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-black text-foreground">{e.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{new Date(e.startsAt).toLocaleDateString()} — {e.venue.name}</div>
                      </div>
                      <div className="text-[10px] uppercase font-mono bg-accent text-accent-foreground px-2 py-0.5 rounded font-bold">
                        {e.city}
                      </div>
                    </div>
                    
                    <div className="pt-3 mt-3 border-t border-border flex items-center justify-between">
                      {e.contract_address ? (
                         <div className="bg-success/10 border border-success/20 text-success text-xs font-black px-3 py-1.5 rounded flex items-center gap-1.5 w-full justify-center">
                           <span>ON-CHAIN ✓</span>
                           <a target="_blank" rel="noreferrer" href={`https://testnet.stellarchain.io/contracts/${e.contract_address}`} className="font-mono underline hover:text-success/80 ml-2">
                             {e.contract_address.slice(0,8)}...{e.contract_address.slice(-6)}
                           </a>
                         </div>
                      ) : (
                         <button 
                           onClick={() => deployContract(e.id)} 
                           disabled={deployingId === e.id}
                           className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold text-xs py-2 rounded shadow transition-all"
                         >
                           <Rocket className={`w-4 h-4 ${deployingId === e.id ? 'animate-bounce' : ''}`} /> 
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
          </div>

        </div>

          {/* CONTRACT EXPLORER */}
          {contractsData && contractsData.factoryContractId && (
            <div className="md:col-span-2 bg-card rounded-xl p-6 border border-amber-500/20 shadow-sm overflow-hidden flex flex-col lg:col-span-2 mt-4">
              <h2 className="text-xl font-black flex items-center gap-2 uppercase tracking-tight text-amber-500 mb-6">
                <ShieldCheck className="w-6 h-6" /> Explorador de Contratos On-Chain
              </h2>
              
              <div className="mb-8 p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10"><Building className="w-24 h-24" /></div>
                <h3 className="text-sm font-bold text-amber-500 uppercase flex items-center gap-1.5"><Rocket className="w-4 h-4"/> Supremo: Soroban Factory Contract</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-3">La célula organizadora de nuestra arquitectura Web3. Fabrica boletos descentralizados por evento.</p>
                <div className="font-mono bg-background p-3 rounded-md text-sm border border-border flex items-center justify-between">
                  <span className="truncate mr-4 text-foreground/80">{contractsData.factoryContractId}</span>
                  <a target="_blank" rel="noreferrer" href={`https://stellar.expert/explorer/testnet/contract/${contractsData.factoryContractId}`} className="text-[10px] text-blue-500 font-bold hover:underline flex items-center gap-1 shrink-0 bg-blue-500/10 px-2 py-1 rounded">Stellar Expert <ExternalLink className="w-3 h-3"/></a>
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
                        <a target="_blank" rel="noreferrer" href={`https://stellar.expert/explorer/testnet/contract/${c.contract_address}`} className="text-[9px] bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded-sm font-black hover:bg-primary hover:text-white transition-colors shrink-0">VISUAlIZAR</a>
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

      </main>
      <Footer />
    </div>
  );
};

export default AdminDashboard;
