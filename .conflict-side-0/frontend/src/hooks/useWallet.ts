import { useContext } from "solid-js"
import { WalletContext } from "@/contexts/wallet-context"

export const useWallet = () => {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
