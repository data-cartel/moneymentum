import { useContext } from "solid-js"
import { NetworkContext } from "@/contexts/network-context"

export const useNetwork = () => {
  const context = useContext(NetworkContext)
  if (context === undefined) {
    throw new Error("useNetwork must be used within a NetworkProvider")
  }
  return context
}
