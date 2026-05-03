import { useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP } from "@/hooks/useXlmPrice";

// Freighter v6 returns objects, not primitives. Helper to safely call its API.
const freighterApi = () => import("@stellar/freighter-api");

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const isFreighterInjected = () => typeof window !== "undefined" && Boolean((window as any).freighter);
const isSafariBrowser = () =>
  typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

export const ConnectWallet = () => {
  const { walletAddress, setWalletAddress, linkWallet, isLoggedIn, balanceVersion } = useAppContext();
  const address = walletAddress;
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(!walletAddress);
  const xlmCop = useXlmPrice();

  const fetchBalance = async (pk: string) => {
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${pk}`);
      if (!res.ok) return;
      const data = await res.json();
      const native = data.balances?.find((b: any) => b.asset_type === "native");
      if (native) setBalance(parseFloat(native.balance).toFixed(2));
    } catch {
      // Silently fail — balance is optional UX
    }
  };

  const tryLinkWallet = async (pk: string): Promise<boolean> => {
    try {
      await linkWallet(pk);
      return true;
    } catch (err: any) {
      const msg = err.message ?? "";
      if (msg.includes("409") || msg.includes("ya vinculada")) {
        alert("Esta billetera ya está vinculada a otra cuenta. Cambia de cuenta en Freighter o usa otra billetera.");
        return false;
      }
      console.error("linkWallet error:", err);
      return true;
    }
  };

  // Refresh balance when balanceVersion changes (after buy/list/cancel) or address loads
  useEffect(() => {
    if (address) fetchBalance(address);
  }, [balanceVersion, address]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect Freighter only if logged in AND no address cached in context yet.
  useEffect(() => {
    if (!isLoggedIn) {
      setBalance(null);
      setWalletAddress(null);
      setLoading(false);
      return;
    }
    if (address) {
      setLoading(false);
      return;
    }
    const checkConnection = async () => {
      try {
        if (!isFreighterInjected()) return;
        const api = await freighterApi();
        const allowResult = await api.isAllowed();
        const allowed = (allowResult as any)?.isAllowed ?? allowResult;
        if (!allowed) return;
        const addrResult = await api.getAddress();
        const pk = (addrResult as any)?.address ?? (typeof addrResult === "string" ? addrResult : "");
        if (pk) {
          const linked = await tryLinkWallet(pk);
          if (linked) {
            setWalletAddress(pk);
          }
        }
      } catch (error) {
        console.error("Freighter check error:", error);
      } finally {
        setLoading(false);
      }
    };
    checkConnection();
  }, [setWalletAddress, linkWallet, isLoggedIn, address]);

  const connectWallet = async () => {
    if (!isLoggedIn) {
      alert("Inicia sesión primero para vincular tu billetera.");
      return;
    }
    try {
      if (isSafariBrowser() && !isFreighterInjected()) {
        alert("No detecté Freighter en Safari. Para esta demo usa Chrome o Brave con la extensión Freighter instalada y desbloqueada.");
        window.open("https://freighter.app", "_blank");
        return;
      }
      const api = await freighterApi();
      const accessResult = await api.requestAccess();
      if ((accessResult as any)?.error) {
        alert((accessResult as any).error.message ?? "Freighter no permitió conectar la billetera.");
        return;
      }
      const pk = (accessResult as any)?.address ?? (typeof accessResult === "string" ? accessResult : "");
      if (pk) {
        const linked = await tryLinkWallet(pk);
        if (linked) {
          setWalletAddress(pk);
        }
      } else {
        alert("Freighter no devolvió una dirección. Desbloquea la extensión, permite el sitio y vuelve a intentar.");
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
      alert("No fue posible conectar Freighter. Verifica que la extensión esté instalada, desbloqueada y con permisos para localhost; luego recarga la página.");
    }
  };

  if (!isLoggedIn) return null;
  if (loading) return null;

  return (
    <button
      onClick={address ? () => {} : connectWallet}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all border shadow-sm cursor-pointer
        ${address
          ? "bg-purple-600 border-purple-800 text-white hover:bg-purple-700"
          : "bg-white text-primary border-primary/20 hover:bg-gray-50"}`
      }
    >
      <Wallet className="w-4 h-4" />
      <span>
        {address
          ? `${address.slice(0,4)}...${address.slice(-4)}`
          : "Connect Wallet"}
      </span>
      {balance && (
        <span className="text-[10px] bg-purple-800/50 px-1.5 py-0.5 rounded font-mono">
          {balance} XLM
          {xlmCop ? ` ~ ${formatCOP(parseFloat(balance) * xlmCop)}` : ""}
        </span>
      )}
    </button>
  );
};
