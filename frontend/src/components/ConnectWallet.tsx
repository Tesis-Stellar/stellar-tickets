import { useCallback, useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import { useAppContext } from "@/context/AppContext";
import { useXlmPrice, formatCOP } from "@/hooks/useXlmPrice";
import { useToast } from "@/hooks/use-toast";

// Freighter v6 returns objects, not primitives. Helper to safely call its API.
const freighterApi = () => import("@stellar/freighter-api");

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const getErrorMessage = (error: unknown, fallback = "") =>
  error instanceof Error ? error.message : fallback;
const hasFreighterError = (value: unknown) =>
  isRecord(value) && isRecord(value.error);
const getFreighterErrorMessage = (value: unknown, fallback: string) =>
  isRecord(value) && isRecord(value.error) && typeof value.error.message === "string"
    ? value.error.message
    : fallback;
const getFreighterAddress = (value: unknown) =>
  typeof value === "string" ? value : isRecord(value) && typeof value.address === "string" ? value.address : "";
const getFreighterFlag = (value: unknown, key: "isAllowed" | "isConnected") =>
  typeof value === "boolean" ? value : isRecord(value) && typeof value[key] === "boolean" ? value[key] : false;
const isFreighterInjected = () => typeof window !== "undefined" && "freighter" in window;
const isSafariBrowser = () =>
  typeof navigator !== "undefined" &&
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

export const ConnectWallet = () => {
  const { walletAddress, setWalletAddress, linkWallet, isLoggedIn, balanceVersion, user } = useAppContext();
  const { toast } = useToast();
  const address = walletAddress;
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(!walletAddress);
  const xlmCop = useXlmPrice();
  const canUseWallet = isLoggedIn && user?.role === "CUSTOMER";

  const fetchBalance = useCallback(async (pk: string) => {
    try {
      const res = await fetch(`${HORIZON_URL}/accounts/${pk}`);
      if (!res.ok) return;
      const data = (await res.json()) as { balances?: Array<{ asset_type?: string; balance?: string }> };
      const native = data.balances?.find((b) => b.asset_type === "native");
      if (native?.balance) setBalance(parseFloat(native.balance).toFixed(2));
    } catch {
      // Silently fail — balance is optional UX
    }
  }, []);

  const tryLinkWallet = useCallback(async (pk: string): Promise<boolean> => {
    try {
      await linkWallet(pk);
      return true;
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      if (msg.includes("409") || msg.includes("ya vinculada")) {
        toast({
          title: "Wallet ya vinculada",
          description: "Esta billetera pertenece a otra cuenta. Cambia de cuenta en Freighter o usa otra wallet.",
          variant: "destructive",
        });
        return false;
      }
      console.error("linkWallet error:", err);
      setWalletAddress(null);
      toast({
        title: "No se pudo verificar la wallet",
        description: msg || "Freighter debe firmar el challenge para vincular esta wallet a tu cuenta.",
        variant: "destructive",
      });
      return false;
    }
  }, [linkWallet, setWalletAddress, toast]);

  // Refresh balance when balanceVersion changes (after buy/list/cancel) or address loads
  useEffect(() => {
    if (address) fetchBalance(address);
  }, [balanceVersion, address, fetchBalance]);

  // Auto-detect Freighter only if logged in AND no address cached in context yet.
  useEffect(() => {
    if (!canUseWallet) {
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
        const allowed = getFreighterFlag(allowResult, "isAllowed");
        if (!allowed) return;
        const addrResult = await api.getAddress();
        const pk = getFreighterAddress(addrResult);
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
  }, [setWalletAddress, canUseWallet, address, tryLinkWallet]);

  const connectWallet = async () => {
    if (!isLoggedIn) {
      toast({
        title: "Inicia sesión primero",
        description: "Necesitas una cuenta activa para vincular Freighter.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (isSafariBrowser() && !isFreighterInjected()) {
        toast({
          title: "Freighter no detectado",
          description: "Para esta demo usa Chrome o Brave con la extensión instalada y desbloqueada.",
          variant: "destructive",
        });
        window.open("https://freighter.app", "_blank");
        return;
      }
      const api = await freighterApi();
      const accessResult = await api.requestAccess();
      if (hasFreighterError(accessResult)) {
        toast({
          title: "Freighter rechazó la conexión",
          description: getFreighterErrorMessage(accessResult, "La extensión no permitió conectar la billetera."),
          variant: "destructive",
        });
        return;
      }
      const pk = getFreighterAddress(accessResult);
      if (pk) {
        const linked = await tryLinkWallet(pk);
        if (linked) {
          setWalletAddress(pk);
        }
      } else {
        toast({
          title: "Wallet no disponible",
          description: "Desbloquea Freighter, permite el sitio y vuelve a intentar.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
      toast({
        title: "No fue posible conectar Freighter",
        description: "Verifica que la extensión esté instalada, desbloqueada y con permisos para este sitio.",
        variant: "destructive",
      });
    }
  };

  if (!canUseWallet) return null;
  if (loading) return null;

  return (
    <button
      onClick={address ? () => {} : connectWallet}
      className={`h-10 max-w-[260px] flex items-center gap-2 px-3 text-sm font-bold rounded-lg transition-all border shadow-sm cursor-pointer overflow-hidden
        ${address
          ? "bg-purple-600 border-purple-800 text-white hover:bg-purple-700"
          : "bg-white text-primary border-primary/20 hover:bg-gray-50"}`
      }
    >
      <Wallet className="w-4 h-4 shrink-0" />
      <span className="min-w-0 flex flex-col items-start leading-none">
        <span className="max-w-[120px] truncate">
          {address
            ? `${address.slice(0,4)}...${address.slice(-4)}`
            : "Connect Wallet"}
        </span>
        {address && balance && (
          <span className="mt-1 max-w-[170px] truncate text-[10px] font-mono text-white/80">
            {balance} XLM{xlmCop ? ` ~ ${formatCOP(parseFloat(balance) * xlmCop)}` : ""}
          </span>
        )}
      </span>
    </button>
  );
};
