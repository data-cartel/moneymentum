import { useContext, type ParentComponent } from "solid-js"
import { QueryClientProvider, useQueryClient } from "@tanstack/solid-query"

import { NetworkContext } from "@/contexts/network-context"
import { ThemeProviderContext } from "@/contexts/theme-context"
import { WalletContext } from "@/contexts/wallet-context"

/**
 * Capture app providers from the Portfolio tree and re-provide them inside
 * dockview panel portals. Dockview mounts panels via a detached Solid root
 * (`render()`), which drops ambient context unless we either inherit the
 * parent owner or wrap panel JSX with these providers.
 */
export const useDockviewPanelProviders = (): ParentComponent => {
  const wallet = useContext(WalletContext)
  const network = useContext(NetworkContext)
  const theme = useContext(ThemeProviderContext)
  const queryClient = useQueryClient()

  if (!wallet) {
    throw new Error("useDockviewPanelProviders requires WalletProvider")
  }
  if (!network) {
    throw new Error("useDockviewPanelProviders requires NetworkProvider")
  }
  if (!theme) {
    throw new Error("useDockviewPanelProviders requires ThemeProvider")
  }

  return props => (
    <QueryClientProvider client={queryClient}>
      <ThemeProviderContext.Provider value={theme}>
        <NetworkContext.Provider value={network}>
          <WalletContext.Provider value={wallet}>
            {props.children}
          </WalletContext.Provider>
        </NetworkContext.Provider>
      </ThemeProviderContext.Provider>
    </QueryClientProvider>
  )
}
