import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AccountSidebar } from "@/components/layout/AccountSidebar";
import { useAppContext } from "@/context/AppContext";
import { AlertCircle, Loader2, MessageSquareText, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ClaimType =
  | "TICKET_NOT_RECEIVED"
  | "INVALID_QR"
  | "DUPLICATE_OR_USED_TICKET"
  | "FAILED_TRANSACTION"
  | "INCORRECT_INFORMATION"
  | "REFUND_OR_REVIEW"
  | "OTHER";

type Claim = {
  id: string;
  type: ClaimType;
  status: string;
  subject: string;
  description: string;
  ticketId?: string | null;
  orderId?: string | null;
  eventId?: string | null;
  relatedTxHash?: string | null;
  createdAt: string;
  updatedAt: string;
  messages: { id: string; message: string; createdAt: string; author?: { name: string; role: string } | null }[];
};

const claimTypes: { value: ClaimType; label: string }[] = [
  { value: "TICKET_NOT_RECEIVED", label: "Ticket no recibido" },
  { value: "INVALID_QR", label: "QR inválido" },
  { value: "DUPLICATE_OR_USED_TICKET", label: "Ticket duplicado/usado" },
  { value: "FAILED_TRANSACTION", label: "Transacción fallida" },
  { value: "INCORRECT_INFORMATION", label: "Información incorrecta" },
  { value: "REFUND_OR_REVIEW", label: "Solicitud de devolución/revisión" },
  { value: "OTHER", label: "Otro" },
];

const statusLabel: Record<string, string> = {
  OPEN: "Abierto",
  IN_REVIEW: "En revisión",
  WAITING_USER: "Esperando usuario",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CANCELLED: "Cancelado",
};

const Claims = () => {
  const { isLoggedIn, authStatus, purchasedTickets, refreshTickets, apiFetch } = useAppContext();
  const { toast } = useToast();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<ClaimType>("INVALID_QR");
  const [ticketId, setTicketId] = useState("");
  const [relatedTxHash, setRelatedTxHash] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const loadClaims = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Claim[]>("/api/claims");
      setClaims(data);
    } catch (error) {
      toast({
        title: "No se pudieron cargar los reclamos",
        description: error instanceof Error ? error.message : "Intenta de nuevo en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, toast]);

  useEffect(() => {
    if (!isLoggedIn) return;
    refreshTickets().catch(() => {});
    loadClaims();
  }, [isLoggedIn, refreshTickets, loadClaims]);

  const selectedTicket = useMemo(
    () => purchasedTickets.find((ticket) => ticket.id === ticketId),
    [purchasedTickets, ticketId]
  );

  if (authStatus === "checking") {
    return <div className="min-h-screen bg-background flex flex-col"><Header /><main className="flex-1 flex items-center justify-center px-4"><p className="text-sm font-bold text-muted-foreground">Cargando sesión...</p></main><Footer /></div>;
  }
  if (!isLoggedIn) return <Navigate to="/login" replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ticketId && !relatedTxHash.trim()) {
      toast({
        title: "Asocia el reclamo",
        description: "Selecciona un ticket o agrega un hash de transacción relacionado.",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    try {
      await apiFetch<Claim>("/api/claims", {
        method: "POST",
        body: JSON.stringify({
          type,
          ticketId: ticketId || undefined,
          eventId: selectedTicket?.event?.id,
          relatedTxHash: relatedTxHash.trim() || undefined,
          subject,
          description,
        }),
      });
      toast({ title: "Reclamo creado", description: "Se guardó la evidencia técnica para revisión." });
      setSubject("");
      setDescription("");
      setRelatedTxHash("");
      await loadClaims();
    } catch (error) {
      toast({
        title: "No se pudo crear el reclamo",
        description: error instanceof Error ? error.message : "Revisa los datos e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 max-w-6xl mx-auto px-4 py-8 w-full">
        <h1 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">PQR y Reclamos</h1>
        <div className="grid lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1"><AccountSidebar /></div>
          <div className="lg:col-span-3 space-y-5">
            <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-primary" />
                <h2 className="font-black text-foreground">Crear reclamo</h2>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <label className="space-y-1 text-sm font-semibold">
                  Tipo
                  <select value={type} onChange={(e) => setType(e.target.value as ClaimType)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {claimTypes.map((claimType) => (
                      <option key={claimType.value} value={claimType.value}>{claimType.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm font-semibold">
                  Ticket relacionado
                  <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <option value="">Sin ticket específico</option>
                    {purchasedTickets.map((ticket) => (
                      <option key={ticket.id} value={ticket.id}>
                        {ticket.event?.title ?? "Evento"} · {ticket.ticketType?.name ?? "Boleta"} · {ticket.ticketCode ?? ticket.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-1 text-sm font-semibold block">
                Hash de transacción opcional
                <input value={relatedTxHash} onChange={(e) => setRelatedTxHash(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono" placeholder="tx hash si aplica" />
              </label>

              <label className="space-y-1 text-sm font-semibold block">
                Asunto
                <input value={subject} onChange={(e) => setSubject(e.target.value)} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Ej. Mi QR aparece inválido" />
              </label>

              <label className="space-y-1 text-sm font-semibold block">
                Descripción
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none" placeholder="Describe qué ocurrió y cuándo lo notaste." />
              </label>

              <button disabled={creating} className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-black text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {creating ? "Guardando evidencia..." : "Crear reclamo"}
              </button>
            </form>

            <section className="space-y-3">
              <h2 className="font-black text-foreground flex items-center gap-2">
                <MessageSquareText className="w-5 h-5 text-primary" />
                Historial de reclamos
              </h2>
              {loading ? (
                <div className="text-center py-12">
                  <Loader2 className="w-10 h-10 text-primary mx-auto mb-3 animate-spin" />
                  <p className="text-sm font-bold text-muted-foreground">Cargando reclamos...</p>
                </div>
              ) : claims.length === 0 ? (
                <div className="text-center py-12 bg-card rounded-xl border border-border">
                  <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-bold text-foreground">No tienes reclamos</p>
                  <p className="text-sm text-muted-foreground">Cuando reportes un incidente aparecerá aquí con su bitácora.</p>
                </div>
              ) : (
                claims.map((claim) => (
                  <article key={claim.id} className="bg-card rounded-xl border border-border p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-foreground">{claim.subject}</h3>
                        <p className="text-xs text-muted-foreground">
                          {claimTypes.find((item) => item.value === claim.type)?.label ?? claim.type} · {new Date(claim.createdAt).toLocaleString("es-CO")}
                        </p>
                      </div>
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">
                        {statusLabel[claim.status] ?? claim.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{claim.description}</p>
                    <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                      Evidencia guardada: ticket {claim.ticketId ? claim.ticketId.slice(0, 8) : "no asociado"} · orden {claim.orderId ? claim.orderId.slice(0, 8) : "no asociada"}
                    </div>
                    {claim.messages.length > 0 ? (
                      <div className="space-y-2">
                        {claim.messages.map((message) => (
                          <div key={message.id} className="border-l-2 border-primary/30 pl-3 text-xs">
                            <p className="font-semibold text-foreground">{message.author?.name ?? "Sistema"} · {new Date(message.createdAt).toLocaleString("es-CO")}</p>
                            <p className="text-muted-foreground">{message.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Claims;
