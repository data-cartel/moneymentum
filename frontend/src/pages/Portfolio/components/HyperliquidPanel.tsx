import { createEffect, createSignal, Show, type JSX } from "solid-js"
import * as Effect from "effect/Effect"
import * as Data from "effect/Data"
import { toast } from "solid-sonner"

import { Button } from "@/components/ui/button"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  ensureEvmAppKit,
  hasLiveEip1193Provider,
  prefetchEvmAppKit,
  readEvmAddressFromAccountState,
  readEvmWalletConnectedFromAccountState,
  readReownProjectId,
} from "@/reown/evmAppKit"
import { tryUsePortfolioShell } from "../portfolioShellContext"
import { AllSymbolsPanel } from "./AllSymbolsPanel"
import type { PortfolioInterface } from "../hooks/usePortfolioState"
import type { PortfolioMetricVisibility } from "./PositionsPanel/portfolioMetricVisibility"

class ReownModalOpenFailed extends Data.TaggedError("ReownModalOpenFailed")<{
  readonly cause: unknown
}> {}

export const openHyperliquidConnectModal = (options: {
  setMainAddress: (address: string | null) => void
  onOpeningChange?: (opening: boolean) => void
  /** Fired when AppKit reports a connected EVM account (may precede provider). */
  onConnected?: (address: string) => void
}): void => {
  const projectIdConfigured = readReownProjectId() !== null
  if (!projectIdConfigured) {
    toast.error("Set VITE_REOWN_PROJECT_ID in .env to connect a wallet.")
    return
  }

  options.onOpeningChange?.(true)

  void Effect.runPromise(
    Effect.gen(function* () {
      const modal = yield* Effect.tryPromise({
        try: () => ensureEvmAppKit(),
        catch: cause => new ReownModalOpenFailed({ cause }),
      })
      if (!modal) {
        return yield* Effect.fail(
          new ReownModalOpenFailed({
            cause: new Error(
              "Set VITE_REOWN_PROJECT_ID in .env to connect a wallet.",
            ),
          }),
        )
      }

      let notifiedConnected = false
      modal.subscribeAccount(accountState => {
        const nextAddress = readEvmAddressFromAccountState(accountState)
        const connected =
          readEvmWalletConnectedFromAccountState(accountState) ||
          nextAddress !== null

        if (connected && nextAddress) {
          options.setMainAddress(nextAddress)
          if (!notifiedConnected) {
            notifiedConnected = true
            options.onConnected?.(nextAddress)
          }
        }
        // Ignore AppKit disconnect flickers after Connect closes; the wallet
        // provider keeps the remembered public address until explicit revoke.
      }, "eip155")

      yield* Effect.tryPromise({
        try: () => modal.open({ view: "Connect", namespace: "eip155" }),
        catch: cause => new ReownModalOpenFailed({ cause }),
      })
    }).pipe(
      Effect.catchAll(error =>
        Effect.sync(() => {
          console.error("Failed to open Reown AppKit:", error)
          toast.error(getErrorMessage(error))
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          options.onOpeningChange?.(false)
        }),
      ),
    ),
  )
}

/**
 * Connects the user's main EVM wallet via Reown AppKit. Sets mainAddress for
 * read-only Hyperliquid balance/position loads -- no private keys involved.
 */
export const WalletInlineConnect = (): JSX.Element => {
  const { setMainAddress, mainAddress } = useWallet()
  const [isOpening, setIsOpening] = createSignal(false)

  const projectIdConfigured = () => readReownProjectId() !== null

  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-4 text-[16px] text-muted-foreground">
      <p class="max-w-[45ch] text-center font-medium text-foreground">
        Connect wallet to load your Hyperliquid portfolio
      </p>
      <p class="max-w-[45ch] text-center text-[12px] leading-snug">
        Connect your main EVM wallet with Reown. Positions load read-only. Use
        Connect Hyperliquid agent to authorize a trading agent.
      </p>
      <Show
        when={projectIdConfigured()}
        fallback={
          <p class="max-w-[45ch] text-center text-[12px] text-destructive">
            Set VITE_REOWN_PROJECT_ID in frontend/.env to enable wallet connect.
          </p>
        }
      >
        <Show
          when={!mainAddress()}
          fallback={
            <p class="font-mono text-[12px] text-foreground">{mainAddress()}</p>
          }
        >
          <Button
            type="button"
            class="h-8 w-full max-w-[45ch] text-[12px] transition-opacity"
            classList={{ "opacity-50": isOpening() }}
            disabled={isOpening()}
            onPointerEnter={() => {
              prefetchEvmAppKit()
            }}
            onClick={() => {
              openHyperliquidConnectModal({
                setMainAddress,
                onOpeningChange: setIsOpening,
              })
            }}
          >
            {isOpening() ? "Loading wallet..." : "Connect wallet"}
          </Button>
        </Show>
      </Show>
    </div>
  )
}

interface HyperliquidPanelProps {
  screenerSymbols: () => string[]
  targetPortfolio: Record<string, PortfolioInterface | undefined>
  deletedArchive: Record<string, PortfolioInterface | undefined>
  fundingIsLoading: boolean
  fundingRatesByBaseSymbol: Record<string, number>
  metricVisibility: PortfolioMetricVisibility
  onRemove: (symbol: string) => void
  onUndoRemove: (symbol: string) => void
  onAddSymbol: (symbol: string) => void
}

/**
 * Hyperliquid tab: All Symbols markets gated only by Reown main-wallet
 * connect. Agent PIN unlock stays on staged trades (trading only).
 */
export const HyperliquidPanel = (props: HyperliquidPanelProps): JSX.Element => {
  const { isHyperliquidConnected, setMainAddress } = useWallet()
  const shell = tryUsePortfolioShell()
  const [isOpening, setIsOpening] = createSignal(false)

  // createEffect: honor portfolio shell request to open Reown connect.
  // Remembered public address counts as "connected" for portfolio loads, but
  // openConnect still needs the AppKit modal when the injected provider is gone.
  createEffect(() => {
    const request = shell?.focusVenueRequest()
    if (request?.venue !== "hyperliquid" || !request.openConnect) {
      return
    }
    shell?.clearFocusVenueRequest()
    void (async () => {
      if (await hasLiveEip1193Provider()) {
        return
      }
      openHyperliquidConnectModal({
        setMainAddress,
        onOpeningChange: setIsOpening,
      })
    })()
  })

  return (
    <div
      class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-primary"
      tabIndex={0}
      data-portfolio-panel="hyperliquid"
    >
      <Show when={isHyperliquidConnected()} fallback={<WalletInlineConnect />}>
        <div class="min-h-0 flex-1">
          <AllSymbolsPanel
            screenerSymbols={props.screenerSymbols}
            targetPortfolio={props.targetPortfolio}
            deletedArchive={props.deletedArchive}
            fundingIsLoading={props.fundingIsLoading}
            fundingRatesByBaseSymbol={props.fundingRatesByBaseSymbol}
            metricVisibility={props.metricVisibility}
            onRemove={props.onRemove}
            onUndoRemove={props.onUndoRemove}
            onAddSymbol={props.onAddSymbol}
          />
        </div>
      </Show>
      <Show when={isOpening()}>
        <span class="sr-only">Opening wallet connect...</span>
      </Show>
    </div>
  )
}
