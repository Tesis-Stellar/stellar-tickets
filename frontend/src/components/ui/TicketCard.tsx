import { QrCode, MapPin, Calendar, ShieldCheck, Lock, ExternalLink, Tag, AlertTriangle } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import type { PurchasedTicket } from "@/context/AppContext";
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

export const TicketCard = ({ ticket }: { ticket: PurchasedTicket }) => {
  const { secureTicketOnChain, listTicketForSale, cancelResaleListing, walletAddress } = useAppContext();
  const xlmCopPrice = useXlmPrice();
  const [isMinting, setIsMinting] = useState(false);
  const [isMinted, setIsMinted] = useState(ticket.isSecuredOnChain ?? false);
  const [isListing, setIsListing] = useState(false);
  const [isListed, setIsListed] = useState(ticket.isForSale ?? false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [resaleDialogOpen, setResaleDialogOpen] = useState(false);
  const [resalePriceInput, setResalePriceInput] = useState("");
  const [nftDialogOpen, setNftDialogOpen] = useState(false);
  const [justMintedNftAddress, setJustMintedNftAddress] = useState<string | null>(null);
  const [secureDialogOpen, setSecureDialogOpen] = useState(false);
  const [secureAck, setSecureAck] = useState(false);

  const parsedPriceCOP = Number(resalePriceInput.replace(/[^\d]/g, ""));
  const previewXLM = xlmCopPrice && parsedPriceCOP > 0 ? parsedPriceCOP / xlmCopPrice : 0;

  const openSecureDialog = () => {
    if (!walletAddress) {
      alert("Debes conectar tu wallet de Freighter antes de asegurar el boleto en blockchain. Haz clic en \"Conectar Wallet\" en la parte superior de la página.");
      return;
    }
    setSecureAck(false);
    setSecureDialogOpen(true);
  };

  const confirmSecureTicket = async () => {
    setSecureDialogOpen(false);
    try {
      setIsMinting(true);
      const result = await secureTicketOnChain(ticket.id);
      if (result.success) {
        setIsMinted(true);
        setTxHash(result.txHash ?? null);
        const nftAddr = result.nftContractAddress ?? null;
        if (nftAddr) {
          setJustMintedNftAddress(nftAddr);
          setNftDialogOpen(true);
        }
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (e) {
      console.error(e);
      alert("Error al asegurar en blockchain");
    } finally {
      setIsMinting(false);
    }
  };

  const openResaleDialog = () => {
    if (!walletAddress) {
      alert("Debes conectar tu wallet de Freighter antes de poner el boleto en reventa. Haz clic en \"Conectar Wallet\" en la parte superior de la página.");
      return;
    }
    if (!xlmCopPrice) {
      alert("No se pudo obtener la cotización XLM/COP. Intenta de nuevo en unos segundos.");
      return;
    }
    setResalePriceInput("");
    setResaleDialogOpen(true);
  };

  const confirmResaleListing = async () => {
    if (!xlmCopPrice || parsedPriceCOP <= 0) return;
    const priceXLM = parsedPriceCOP / xlmCopPrice;
    setResaleDialogOpen(false);
    try {
      setIsListing(true);
      const result = await listTicketForSale(ticket.id, priceXLM);
      if (result.success) {
        setIsListed(true);
        setTxHash(result.txHash ?? txHash);
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (e) {
      console.error(e);
      alert("Error al listar en blockchain");
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
          <span>{typeof ticket.event.venue === 'object' ? (ticket.event.venue as any)?.name : ticket.event.venue}, {ticket.event.city}</span>
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
                <ShieldCheck className="w-4 h-4" /> Asegurado en Blockchain
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
                        const result = await cancelResaleListing(ticket.id);
                        if (result.success) {
                          setIsListed(false);
                          setTxHash(result.txHash ?? txHash);
                        } else {
                          alert(`Error: ${result.error}`);
                        }
                      } catch (e) {
                        console.error(e);
                        alert("Error al cancelar reventa");
                      } finally {
                        setIsCancelling(false);
                      }
                    }}
                    disabled={isCancelling}
                    className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-black rounded-lg transition-colors w-fit ${isCancelling ? "bg-muted text-muted-foreground" : "bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-900/20"}`}
                  >
                    {isCancelling ? "Cancelando..." : "Cancelar Reventa"}
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
              {ticket.nftContractAddress && (
                <button
                  onClick={() => {
                    setJustMintedNftAddress(ticket.nftContractAddress ?? null);
                    setNftDialogOpen(true);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-purple-400 hover:text-purple-300 transition-colors"
                >
                  Ver NFT en Freighter
                </button>
              )}
            </div>
            {!isListed && (
              <button
                onClick={openResaleDialog}
                disabled={isListing}
                className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-black rounded-lg transition-colors shadow-md shadow-blue-900/20 w-fit ${isListing ? "bg-muted text-muted-foreground" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
              >
                {isListing ? "Listando en Soroban..." : "Revender NFT"}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={openSecureDialog}
            disabled={isMinting}
            className={`inline-flex items-center gap-1.5 px-4 py-2 mt-2 text-xs font-black rounded-lg transition-all ${isMinting ? "bg-muted text-muted-foreground" : "bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-900/20"}`}
          >
            <Lock className="w-3.5 h-3.5" />
            {isMinting ? "Registrando en Soroban..." : "Asegurar en Blockchain"}
          </button>
        )}
      </div>
      {/* QR de entrada — solo se muestra cuando el dueño actual tiene
          control real del boleto: asegurado en blockchain Y no publicado en
          reventa. Si está sin asegurar, mostramos un disclaimer; si está
          listado para reventa, mostramos que el QR queda suspendido hasta
          que se cancele o se concrete la venta. Esto evita que un vendedor
          escanee un QR cacheado tras revender. */}
      <div className="flex flex-col items-center justify-center sm:border-l sm:border-border sm:pl-4 min-w-[140px] max-w-[180px]">
        {isMinted && !isListed ? (
          <>
            <div className="p-2 bg-white rounded-lg shadow-sm">
              <QRCodeCanvas
                value={JSON.stringify({
                  contractAddress: ticket.contractAddress,
                  ticketRootId: ticket.ticketRootId,
                  version: ticket.version ?? 1,
                })}
                size={80}
                level={"H"}
                bgColor={"#ffffff"}
                fgColor={"#000000"}
              />
            </div>
            <span className="text-[10px] text-muted-foreground font-bold mt-2 uppercase tracking-tight text-center">
              QR Válido
            </span>
          </>
        ) : isMinted && isListed ? (
          <div className="flex flex-col items-center text-center gap-1.5 px-2">
            <div className="w-16 h-16 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Tag className="w-7 h-7 text-amber-500" />
            </div>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-black uppercase tracking-tight">
              QR Suspendido
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              Boleta publicada en reventa P2P. Cancela la reventa para recuperar tu QR.
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-1.5 px-2">
            <div className="w-16 h-16 rounded-lg bg-muted border border-border flex items-center justify-center">
              <QrCode className="w-7 h-7 text-muted-foreground" />
            </div>
            <span className="text-[10px] text-muted-foreground font-black uppercase tracking-tight">
              QR no disponible
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              Asegura tu boleta en blockchain para liberar tu QR de entrada.
            </span>
          </div>
        )}
      </div>
    </div>

    <Dialog open={secureDialogOpen} onOpenChange={setSecureDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asegurar boleta en blockchain</DialogTitle>
          <DialogDescription>
            Al asegurar tu boleta recibirás el <b>QR de entrada</b> que representa tu acceso al evento. A partir de ese momento, ese QR es tu boleta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Es una responsabilidad grande</p>
              <p>
                Cualquiera que tenga una foto o captura de tu QR puede entrar al evento en tu lugar. Si compartes el QR, regalas tu boleta.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground mb-1">Te recomendamos asegurar tu boleta solo si:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Quieres revenderla en el marketplace P2P.</li>
              <li>Se la vas a regalar o transferir a alguien.</li>
            </ul>
            <p className="mt-2">
              Si no, espera al evento: el QR se libera sin riesgo cuando lo necesites.
            </p>
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={secureAck}
              onChange={(e) => setSecureAck(e.target.checked)}
            />
            <span className="text-xs text-muted-foreground">
              Entiendo que el QR representa mi boleta y que compartirlo equivale a regalar mi entrada.
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setSecureDialogOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={confirmSecureTicket}
            disabled={!secureAck}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            Asegurar en Blockchain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

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
            <li>Token ID: <span className="font-mono">{ticket.ticketRootId ?? "—"}</span></li>
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

          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Importante sobre tu QR</p>
              <p>
                Si tienes el QR de este boleto guardado (capturas, descargas o el coleccionable en tu wallet), dejará de ser válido en el momento en que se concrete la reventa. El nuevo dueño recibirá un QR nuevo y el tuyo será rechazado en puerta.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setResaleDialogOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={confirmResaleListing}
            disabled={parsedPriceCOP <= 0 || !xlmCopPrice}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Listar por {parsedPriceCOP > 0 ? formatCOP(parsedPriceCOP) : "—"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
};
