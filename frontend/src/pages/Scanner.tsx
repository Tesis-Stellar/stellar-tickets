import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Scanner, IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, Camera } from "lucide-react";
import { useAppContext } from "@/context/AppContext";

export const ScannerPage = () => {
  const { user, apiFetch } = useAppContext();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: 'success'|'error'; message: string; submessage?: string } | null>(null);

  useEffect(() => {
    if (!user || !['ADMIN', 'STAFF'].includes(user.role)) {
      navigate("/");
    }
  }, [user, navigate]);

  const handleScan = async (detectedCodes: IDetectedBarcode[]) => {
    if (loading || !detectedCodes || detectedCodes.length === 0) return;
    
    const value = detectedCodes[0].rawValue;
    if (!value) return;

    try {
      setLoading(true);
      // Attempt to parse JSON
      const payload = JSON.parse(value);
      if (!payload.ticketId) throw new Error("QR No Reconocido");

      const res = await apiFetch<any>("/api/admin/scan", {
        method: "POST",
        body: JSON.stringify({ ticketId: payload.ticketId })
      });

      if (res.success) {
        setResult({
          type: "success",
          message: "Acceso Permitido",
          submessage: `Entrada validada: ${payload.code || payload.ticketId.slice(0, 8)}`
        });
      }
    } catch (err: any) {
      setResult({
        type: "error",
        message: "Acceso Denegado",
        submessage: err.message || "QR Inválido o ya fue escaneado."
      });
    } finally {
      // Re-enable scanning after 3 seconds
      setTimeout(() => {
        setLoading(false);
        setResult(null);
      }, 3000);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col items-center justify-start py-8 px-4 w-full max-w-lg mx-auto">
        <div className="w-full text-center mb-6">
          <h1 className="text-2xl font-black text-foreground flex items-center justify-center gap-2">
            <Camera className="w-6 h-6 text-primary" /> Validación QR
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Escanea los boletos de los asistentes.</p>
        </div>

        <div className="w-full aspect-square bg-black rounded-3xl overflow-hidden relative shadow-2xl border-4 border-border">
          {!result && !loading && (
            <Scanner 
              onScan={handleScan}
              formats={["qr_code"]}
              styles={{ container: { width: '100%', height: '100%' } }}
            />
          )}

          {/* Overlay scanning state */}
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10 pointer-events-none">
            {loading && <Loader2 className="w-12 h-12 text-white animate-spin" />}
            
            {result?.type === 'success' && (
              <div className="bg-success text-success-foreground p-6 rounded-2xl flex flex-col items-center shadow-2xl animate-in zoom-in-50 duration-300">
                <CheckCircle2 className="w-16 h-16 mb-2" />
                <h2 className="text-xl font-black uppercase tracking-widest">{result.message}</h2>
                {result.submessage && <p className="text-xs mt-1 font-mono opacity-80">{result.submessage}</p>}
              </div>
            )}

            {result?.type === 'error' && (
              <div className="bg-destructive text-destructive-foreground p-6 rounded-2xl flex flex-col items-center shadow-2xl animate-in zoom-in-50 duration-300">
                <XCircle className="w-16 h-16 mb-2" />
                <h2 className="text-xl font-black uppercase tracking-widest">{result.message}</h2>
                {result.submessage && <p className="text-xs mt-1 font-mono opacity-80">{result.submessage}</p>}
              </div>
            )}
            
            {!result && !loading && (
              <div className="w-48 h-48 border-2 border-dashed border-white/50 rounded-xl" />
            )}
          </div>
        </div>

        <div className="mt-8 bg-accent/10 p-4 rounded-xl flex items-start gap-3 w-full border border-accent/20">
          <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Los escaneos verifican la base de datos híbrida de Stellar Tickets de forma instantánea. Las validaciones asíncronas en cadena (Soroban) se ejecutarán en segundo plano.
          </p>
        </div>
      </main>
    </div>
  );
};
