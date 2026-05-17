import { QrCode, MapPin, Calendar, ShieldCheck, Lock, ExternalLink, Tag, CheckCircle2 } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import type { PurchasedTicket, ResaleFlowStatus, ResalePolicyInfo } from "@/context/AppContext";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP } from "@/hooks/useXlmPrice";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export const TicketCard = ({ ticket }: { ticket: PurchasedTicket }) => {
  const { secureTicketOnChain, getTicketResalePolicy, listTicketForSale, cancelResaleListing, walletAddress } = useAppContext();
  const { toast } = useToast();
  const xlmCopPrice = useXlmPrice();
  const [isMinting, setIsMinting] = useState(false);
  const [isMinted, setIsMinted] = useState(ticket.isSecuredOnChain ?? false);
  const [isListing, setIsListing] = useState(false);
  const [isListed, setIsListed] = useState(ticket.isForSale ?? false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [resaleDialogOpen, setResaleDialogOpen] = useState(false);
  const [resalePriceInput, setResalePriceInput] = useState("");
  const [resalePolicy, setResalePolicy] = useState<ResalePolicyInfo | null>(null);
  const [isLoadingResalePolicy, setIsLoadingResalePolicy] = useState(false);
  const [nftDialogOpen, setNftDialogOpen] = useState(false);
  const [justMintedNftAddress, setJustMintedNftAddress] = useState<string | null>(null);
  const [justMintedNftTokenId, setJustMintedNftTokenId] = useState<number | null>(null);
  const [resaleFlowStatus, setResaleFlowStatus] = useState<ResaleFlowStatus | null>(null);
  const [resaleSuccessDialog, setResaleSuccessDialog] = useState<{ kind: "list" | "cancel"; txHash?: string } | null>(null);

  const parsedPriceCOP = Number(resalePriceInput.replace(/[^\d]/g, ""));
  const previewXLM = xlmCopPrice && parsedPriceCOP > 0 ? parsedPriceCOP / xlmCopPrice : 0;
  const organizerFeePct = resalePolicy?.policy?.organizerFeePercent ?? 5;
  const platformFeePct = resalePolicy?.policy?.platformFeePercent ?? 3;
  const sellerPct = 100 - organizerFeePct - platformFeePct;
  const organizerFeeCOP = (parsedPriceCOP * organizerFeePct) / 100;
  const platformFeeCOP = (parsedPriceCOP * platformFeePct) / 100;
  const sellerNetCOP = parsedPriceCOP - organizerFeeCOP - platformFeeCOP;
  const organizerFeeXLM = (previewXLM * organizerFeePct) / 100;
  const platformFeeXLM = (previewXLM * platformFeePct) / 100;
  const sellerNetXLM = previewXLM - organizerFeeXLM - platformFeeXLM;
  const resaleStatusLabel: Record<ResaleFlowStatus, string> = {
    building_xdr: "Preparando XDR...",
    signing: "Esperando firma...",
    submitted: "Enviada a Soroban...",
    reconciling: "Confirmando indexer...",
    confirmed: "Confirmado",
    failed: "Falló",
  };

  const claimTicket = async () => {
    if (!walletAddress) {
      toast({
        title: "Conecta tu wallet",
        description: "Necesitas Freighter conectado desde el header antes de asegurar el boleto en blockchain.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsMinting(true);
      const result = await secureTicketOnChain(ticket.id);
      if (result.success) {
        setIsMinted(true);
        setTxHash(result.txHash ?? null);
        const nftAddr = result.nftContractAddress ?? null;
        if (nftAddr && result.nftTokenId != null) {
          setJustMintedNftAddress(nftAddr);
          setJustMintedNftTokenId(result.nftTokenId);
          setNftDialogOpen(true);
        } else if (result.warning) {
          toast({
            title: "Boleto asegurado",
            description: result.warning,
          });
        }
      } else {
        toast({
          title: "No se pudo asegurar el boleto",
          description: result.error ?? "Intenta nuevamente en unos segundos.",
          variant: "destructive",
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        title: "No se pudo asegurar el boleto",
        description: "Ocurrió un error al registrar el boleto en blockchain.",
        variant: "destructive",
      });
    } finally {
      setIsMinting(false);
    }
  };

  const resaleMaxPriceCOP = resalePolicy?.policy?.maxPriceAmount ?? null;
  const isAboveResaleLimit = resaleMaxPriceCOP != null && parsedPriceCOP > resaleMaxPriceCOP;
  const resaleOriginalPriceCOP = resalePolicy?.policy?.originalPriceAmount ?? ticket.ticketType.price;
  const resaleTicketStatus = resalePolicy?.ticketStatus ?? "ACTIVE";
  const resaleDeadline = resalePolicy?.policy?.resaleDeadline
    ? new Date(resalePolicy.policy.resaleDeadline).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
    : "Sin fecha límite configurada";

  const openResaleDialog = async () => {
    if (!walletAddress) {
      toast({
        title: "Conecta tu wallet",
        description: "Necesitas Freighter conectado desde el header antes de publicar una reventa.",
        variant: "destructive",
      });
      return;
    }
    if (!xlmCopPrice) {
      toast({
        title: "Cotización no disponible",
        description: "No pudimos obtener XLM/COP. Intenta de nuevo en unos segundos.",
        variant: "destructive",
      });
      return;
    }
    try {
      setIsLoadingResalePolicy(true);
      const policy = await getTicketResalePolicy(ticket.id);
      setResalePolicy(policy);
      if (!policy.canList) {
        toast({
          title: "Reventa no permitida",
          description: policy.reason ?? "Este boleto no cumple las reglas de reventa del evento.",
          variant: "destructive",
        });
        return;
      }
    } catch (error) {
      toast({
        title: "No se pudo consultar la política de reventa",
        description: error instanceof Error ? error.message : "Intenta de nuevo en unos segundos.",
        variant: "destructive",
      });
      return;
    } finally {
      setIsLoadingResalePolicy(false);
    }
    setResalePriceInput("");
    setResaleDialogOpen(true);
  };

  const confirmResaleListing = async () => {
    if (!xlmCopPrice || parsedPriceCOP <= 0 || isAboveResaleLimit) return;
    const priceXLM = parsedPriceCOP / xlmCopPrice;
    setResaleDialogOpen(false);
    try {
      setIsListing(true);
      setResaleFlowStatus("building_xdr");
      const result = await listTicketForSale(ticket.id, priceXLM, { onStatus: setResaleFlowStatus, priceCop: parsedPriceCOP });
      if (result.success) {
        setIsListed(true);
        setTxHash(result.txHash ?? txHash);
        setResaleSuccessDialog({ kind: "list", txHash: result.txHash ?? txHash ?? undefined });
      } else {
        toast({
          title: "No se pudo publicar la reventa",
          description: result.error ?? "La operación no fue confirmada.",
          variant: "destructive",
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        title: "No se pudo publicar la reventa",
        description: "Ocurrió un error al listar el boleto en blockchain.",
        variant: "destructive",
      });
    } finally {
      setIsListing(false);
    }
  };

  const stellarExplorerUrl = txHash
    ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
    : ticket.contractAddress
      ? `https://stellar.expert/explorer/testnet/contract/${ticket.contractAddress}`
      : null;

  return (
  <>
  <div className="bg-card rounded-xl border border-border overflow-hidden flex flex-col sm:flex-row">
    <img
      src={ticket.event.image}
      alt={ticket.event.title}
      className="w-full sm:w-40 h-32 sm:h-auto object-cover"
    />
    <div className="flex-1 p-4 flex flex-col sm:flex-row gap-4">
      <div className="flex-1 space-y-2">
        <h3 className="font-bold text-foreground text-sm">{ticket.event.title}</h3>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          <span>{ticket.event.date} {ticket.event.month} {ticket.event.year} · {ticket.event.time}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          <span>{typeof ticket.event.venue === "object" ? ticket.event.venue?.name : ticket.event.venue}, {ticket.event.city}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded-full">
            {ticket.ticketType.name}
          </span>
          <span className="text-xs text-muted-foreground">x {ticket.quantity}</span>
          {ticket.seats?.length ? (
            <span className="text-xs text-muted-foreground">
              Asientos: {ticket.seats.join(", ")}
            </span>
          ) : null}
        </div>
        </div>

        {isMinted ? (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-success/10 text-success text-xs font-black rounded-lg border border-success/20">
                <ShieldCheck className="w-4 h-4" /> Asegurado por Secure Ticket
              </span>
              {isListed && (
                <>
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-black rounded-lg border border-blue-500/20">
                    <Tag className="w-3.5 h-3.5" /> En Venta
                  </span>
                  <button
                    onClick={async () => {
                      try {
                        setIsCancelling(true);
                        setResaleFlowStatus("building_xdr");
                        const result = await cancelResaleListing(ticket.id, { onStatus: setResaleFlowStatus });
                        if (result.success) {
                          setIsListed(false);
                          setTxHash(result.txHash ?? txHash);
                          setResaleSuccessDialog({ kind: "cancel", txHash: result.txHash ?? txHash ?? undefined });
                        } else {
                          toast({
                            title: "No se pudo cancelar la reventa",
                            description: result.error ?? "La operación no fue confirmada.",
                            variant: "destructive",
                          });
                        }
                      } catch (e) {
                        console.error(e);
                        toast({
                          title: "No se pudo cancelar la reventa",
                          description: "Ocurrió un error al retirar el boleto del mercado.",
                          variant: "destructive",
                        });
                      } finally {
                        setIsCancelling(false);
                      }
                    }}
                    disabled={isCancelling}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-black rounded-lg transition-colors w-fit ${isCancelling ? "bg-muted text-muted-foreground" : "bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-900/20"}`}
                  >
                    {isCancelling && resaleFlowStatus ? resaleStatusLabel[resaleFlowStatus] : isCancelling ? "Cancelando..." : "Cancelar Reventa"}
                  </button>
                </>
              )}
              {stellarExplorerUrl && (
                <a
                  href={stellarExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Ver en Stellar Explorer
                </a>
              )}
              {ticket.nftContractAddress && ticket.nftTokenId != null && (
                <button
                  onClick={() => {
                    setJustMintedNftAddress(ticket.nftContractAddress ?? null);
                    setJustMintedNftTokenId(ticket.nftTokenId ?? null);
                    setNftDialogOpen(true);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Ver NFT en Freighter
                </button>
              )}
              {ticket.nftContractAddress && ticket.nftTokenId == null && (
                <button
                  onClick={claimTicket}
                  disabled={isMinting}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] transition-colors ${
                    isMinting ? "text-muted-foreground" : "text-purple-400 hover:text-purple-300"
                  }`}
                >
                  {isMinting ? "Creando NFT..." : "Crear NFT en Freighter"}
                </button>
              )}
            </div>
            {!isListed && (
              <button
                onClick={openResaleDialog}
                disabled={isListing || isLoadingResalePolicy}
                className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-black rounded-lg transition-colors shadow-md shadow-blue-900/20 w-fit ${
                  isListing || isLoadingResalePolicy ? "bg-muted text-muted-foreground" : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {isLoadingResalePolicy
                  ? "Validando reglas..."
                  : isListing && resaleFlowStatus
                    ? resaleStatusLabel[resaleFlowStatus]
                    : isListing
                      ? "Listando en Soroban..."
                      : "Vender boleta"}
              </button>
            )}
            {(isListing || isCancelling) && resaleFlowStatus ? (
              <p className="text-[11px] text-muted-foreground">{resaleStatusLabel[resaleFlowStatus]}</p>
            ) : null}
          </div>
        ) : (
          <button
            onClick={claimTicket}
            disabled={isMinting}
            className={`inline-flex items-center gap-1.5 px-4 py-2 mt-2 text-xs font-black rounded-lg transition-all ${isMinting ? "bg-muted text-muted-foreground" : "bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-900/20"}`}
          >
            <Lock className="w-3.5 h-3.5" />
            {isMinting ? "Registrando en Secure Ticket..." : "Asegurar con Secure Ticket"}
          </button>
        )}
      </div>
      {/* Real QR — once secured on-chain, this matches the QR baked into the
          Freighter Collectible (encodes contractAddress + ticketRootId). */}
      <div className="flex flex-col items-center justify-center sm:border-l sm:border-border sm:pl-4 min-w-[120px]">
        <div className="p-2 bg-white rounded-lg shadow-sm">
          <QRCodeCanvas
            value={
              ticket.qrPayload ??
              JSON.stringify({ ticketId: ticket.id, code: ticket.ticketCode || ticket.id })
            }
            size={80}
            level={"H"}
            bgColor={"#ffffff"}
            fgColor={"#000000"}
          />
        </div>
        <span className="text-[10px] text-muted-foreground font-bold mt-2 uppercase tracking-tight">
          {isMinted ? "EN TU WALLET" : ticket.ticketCode?.slice(0, 10) || "QR-CODE"}
        </span>
      </div>
    </div>

    <Dialog open={nftDialogOpen} onOpenChange={setNftDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tu boleto ahora es un NFT</DialogTitle>
          <DialogDescription>
            Para verlo bajo "Collectibles" en Freighter, agrega esta colección manualmente:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
            <div className="text-xs text-muted-foreground">NFT Contract Address</div>
            <div className="font-mono text-xs break-all">{justMintedNftAddress}</div>
          </div>
          <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
            <li>Abre Freighter → pestaña <b>Collectibles</b></li>
            <li>"Add Collectible" → pega la dirección de arriba</li>
            <li>Token ID: <span className="font-mono">{justMintedNftTokenId ?? ticket.nftTokenId}</span></li>
          </ol>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              if (justMintedNftAddress) navigator.clipboard?.writeText(justMintedNftAddress);
            }}
          >
            Copiar dirección
          </Button>
          <Button onClick={() => setNftDialogOpen(false)} className="bg-purple-600 hover:bg-purple-700 text-white">
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={resaleDialogOpen} onOpenChange={setResaleDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Listar boleto en reventa</DialogTitle>
          <DialogDescription>
            Define el precio de reventa en pesos colombianos. Internamente se firma en XLM al precio actual del mercado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="resale-price-cop">
              Precio en COP
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="resale-price-cop"
                type="text"
                inputMode="numeric"
                placeholder="100000"
                value={resalePriceInput}
                onChange={(e) => setResalePriceInput(e.target.value)}
                className="pl-7"
                autoFocus
              />
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Equivalente en XLM:</span>
              <span className="font-mono font-semibold">
                {previewXLM > 0 ? `${previewXLM.toFixed(4)} XLM` : "—"}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Cotización actual:</span>
              <span>{xlmCopPrice ? `1 XLM ≈ ${formatCOP(xlmCopPrice)}` : "—"}</span>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-2 text-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
              Reglas de reventa del evento
            </p>
            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Precio original</span>
                <span className="font-mono font-semibold">{formatCOP(resaleOriginalPriceCOP)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Precio máximo</span>
                <span className="font-mono font-semibold">
                  {resaleMaxPriceCOP != null ? formatCOP(resaleMaxPriceCOP) : "Sin límite"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Límite de publicación</span>
                <span className="text-right font-medium">{resaleDeadline}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Estado del boleto</span>
                <span className="font-mono font-semibold">{resaleTicketStatus}</span>
              </div>
            </div>
            {isAboveResaleLimit ? (
              <p className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                El precio supera el máximo permitido para este evento.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Desglose de comisiones
            </p>

            <div className="space-y-1">
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-muted-foreground">
                  Organizador <span className="text-xs">({organizerFeePct}%)</span>
                </span>
                <div className="text-right">
                  <span className="font-mono font-semibold text-foreground">
                    {parsedPriceCOP > 0 ? formatCOP(organizerFeeCOP) : "—"}
                  </span>
                  <span className="block text-[10px] text-muted-foreground font-mono">
                    {organizerFeeXLM > 0 ? `${organizerFeeXLM.toFixed(4)} XLM` : ""}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-baseline gap-3">
                <span className="text-muted-foreground">
                  Plataforma <span className="text-xs">({platformFeePct}%)</span>
                </span>
                <div className="text-right">
                  <span className="font-mono font-semibold text-foreground">
                    {parsedPriceCOP > 0 ? formatCOP(platformFeeCOP) : "—"}
                  </span>
                  <span className="block text-[10px] text-muted-foreground font-mono">
                    {platformFeeXLM > 0 ? `${platformFeeXLM.toFixed(4)} XLM` : ""}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-2 flex justify-between items-baseline gap-3">
              <span className="font-bold text-foreground">
                Recibirás <span className="text-xs font-normal text-muted-foreground">({sellerPct}%)</span>
              </span>
              <div className="text-right">
                <span className="font-mono font-bold text-green-600">
                  {parsedPriceCOP > 0 ? formatCOP(sellerNetCOP) : "—"}
                </span>
                <span className="block text-[10px] text-green-700 font-mono">
                  {sellerNetXLM > 0 ? `${sellerNetXLM.toFixed(4)} XLM` : ""}
                </span>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground pt-1">
              Comisiones liquidadas on-chain en Stellar. La tarifa de red la paga el comprador y es despreciable para la demo.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setResaleDialogOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={confirmResaleListing}
            disabled={parsedPriceCOP <= 0 || !xlmCopPrice || isAboveResaleLimit}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isAboveResaleLimit ? "Precio no permitido" : `Listar por ${parsedPriceCOP > 0 ? formatCOP(parsedPriceCOP) : "—"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!resaleSuccessDialog} onOpenChange={(open) => !open && setResaleSuccessDialog(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            {resaleSuccessDialog?.kind === "cancel" ? "Reventa cancelada" : "Boleto publicado en reventa"}
          </DialogTitle>
          <DialogDescription>
            {resaleSuccessDialog?.kind === "cancel"
              ? "Tu boleto se retiró del mercado P2P y vuelve a quedar disponible en Mis Entradas."
              : "Tu boleto quedó publicado en el mercado P2P del evento."}
          </DialogDescription>
        </DialogHeader>

        {resaleSuccessDialog?.txHash ? (
          <div className="rounded-lg bg-muted/50 p-3 space-y-1 text-xs">
            <div className="text-muted-foreground">Transaction hash</div>
            <div className="font-mono break-all text-foreground">{resaleSuccessDialog.txHash}</div>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${resaleSuccessDialog.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-purple-600 hover:text-purple-700 font-semibold mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              Ver en Stellar Explorer
            </a>
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={() => setResaleSuccessDialog(null)} className="bg-purple-600 hover:bg-purple-700 text-white">
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
};
