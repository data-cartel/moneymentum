import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"

import type { PortfolioVenueId } from "@/contexts/wallet-context"

export type FocusVenueRequest =
  | { venue: "hyperliquid"; openConnect: boolean }
  | { venue: "derive"; focusWalletField: boolean }

interface PortfolioShellContextType {
  focusVenueRequest: Accessor<FocusVenueRequest | null>
  focusVenue: (request: FocusVenueRequest) => void
  clearFocusVenueRequest: () => void
}

const PortfolioShellContext = createContext<
  PortfolioShellContextType | undefined
>(undefined)

export const PortfolioShellProvider = (props: ParentProps) => {
  const [focusVenueRequest, setFocusVenueRequest] =
    createSignal<FocusVenueRequest | null>(null)

  const focusVenue = (request: FocusVenueRequest) => {
    setFocusVenueRequest(request)
  }

  const clearFocusVenueRequest = () => {
    setFocusVenueRequest(null)
  }

  return (
    <PortfolioShellContext.Provider
      value={{ focusVenueRequest, focusVenue, clearFocusVenueRequest }}
    >
      {props.children}
    </PortfolioShellContext.Provider>
  )
}

export const usePortfolioShell = (): PortfolioShellContextType => {
  const context = useContext(PortfolioShellContext)
  if (context === undefined) {
    throw new Error(
      "usePortfolioShell must be used within PortfolioShellProvider",
    )
  }
  return context
}

export const tryUsePortfolioShell = (): PortfolioShellContextType | undefined =>
  useContext(PortfolioShellContext)

export type { PortfolioVenueId }
