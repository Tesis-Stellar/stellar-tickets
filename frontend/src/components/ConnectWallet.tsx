import { useState, useEffect } from "react";
import { Wallet } from "lucide-react";
import { useAppContext } from "@/context/AppContext";

// Freighter v6 returns objects, not primitives. Helper to safely call its API.
const freighterApi = () => import("@stellar/freighter-api");

export const ConnectWallet = () => {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { setWalletAddress } = useAppContext();

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const api = await freighterApi();
        const connResult = await api.isConnected();
        const conn = (connResult as any)?.isConnected ?? connResult;
        if (!conn) return;
        const allowResult = await api.isAllowed();
        const allowed = (allowResult as any)?.isAllowed ?? allowResult;
        if (!allowed) return;
        const addrResult = await api.getAddress();
        const pk = (addrResult as any)?.address ?? (typeof addrResult === "string" ? addrResult : "");
        if (pk) {
          setAddress(pk);
          setWalletAddress(pk);
        }
      } catch (error) {
        console.error("Freighter check error:", error);
      } finally {
        setLoading(false);
      }
    };
    checkConnection();
  }, [setWalletAddress]);

  const connectWallet = async () => {
    try {
      const api = await freighterApi();
      const connResult = await api.isConnected();
      const conn = (connResult as any)?.isConnected ?? connResult;
      if (!conn) {
        alert("¡Por favor instala la extensión de Freighter en tu navegador!");
        window.open("https://freighter.app", "_blank");
        return;
      }
      const accessResult = await api.requestAccess();
      const pk = (accessResult as any)?.address ?? (typeof accessResult === "string" ? accessResult : "");
      if (pk) {
        setAddress(pk);
        setWalletAddress(pk);
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
    }
  };

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
    </button>
  );
};
