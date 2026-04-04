import { QrCode, MapPin, Calendar, ShieldCheck, Lock, ExternalLink, Tag } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import type { PurchasedTicket } from "@/context/AppContext";
import { useAppContext } from "@/context/AppContext";
import { useState } from "react";

export const TicketCard = ({ ticket }: { ticket: PurchasedTicket }) => {
  const { secureTicketOnChain, listTicketForSale, cancelResaleListing } = useAppContext();
  const [isMinting, setIsMinting] = useState(false);
  const [isMinted, setIsMinted] = useState(ticket.isSecuredOnChain ?? false);
  const [isListing, setIsListing] = useState(false);
  const [isListed, setIsListed] = useState(ticket.isForSale ?? false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const claimTicket = async () => {
    try {
      setIsMinting(true);
      const result = await secureTicketOnChain(ticket.id);
      if (result.success) {
        setIsMinted(true);
        setTxHash(result.txHash ?? null);
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

  const handleListForSale = async () => {
    const priceStr = prompt("Ingresa el precio de reventa en XLM:");
    if (!priceStr || isNaN(Number(priceStr)) || Number(priceStr) <= 0) return;

    try {
      setIsListing(true);
      const result = await listTicketForSale(ticket.id, Number(priceStr));
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
            </div>
            {!isListed && (
              <button
                onClick={handleListForSale}
                disabled={isListing}
                className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-black rounded-lg transition-colors shadow-md shadow-blue-900/20 w-fit ${isListing ? "bg-muted text-muted-foreground" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
              >
                {isListing ? "Listando en Soroban..." : "Revender NFT"}
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={claimTicket}
            disabled={isMinting}
            className={`inline-flex items-center gap-1.5 px-4 py-2 mt-2 text-xs font-black rounded-lg transition-all ${isMinting ? "bg-muted text-muted-foreground" : "bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-900/20"}`}
          >
            <Lock className="w-3.5 h-3.5" />
            {isMinting ? "Registrando en Soroban..." : "Asegurar en Blockchain"}
          </button>
        )}
      </div>
      {/* Real QR */}
      <div className="flex flex-col items-center justify-center sm:border-l sm:border-border sm:pl-4 min-w-[120px]">
        <div className="p-2 bg-white rounded-lg shadow-sm">
          <QRCodeCanvas 
             value={JSON.stringify({ ticketId: ticket.id, code: ticket.ticketCode || ticket.id })} 
             size={80} 
             level={"H"}
             bgColor={"#ffffff"}
             fgColor={"#000000"}
          />
        </div>
        <span className="text-[10px] text-muted-foreground font-bold mt-2 uppercase tracking-tight">{ticket.ticketCode?.slice(0, 10) || "QR-CODE"}</span>
      </div>
    </div>
  );
};
