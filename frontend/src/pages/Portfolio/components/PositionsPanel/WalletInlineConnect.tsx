import { createSignal, onCleanup, Show, type JSX } from "solid-js"
import * as Effect from "effect/Effect"
import * as Data from "effect/Data"
import { toast } from "solid-sonner"

import { Button } from "@/components/ui/button"
import { getStoredWalletAddresses } from "@/contexts/wallet-context"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  ensureEvmAppKit,
  prefetchEvmAppKit,
  readEvmAddressFromAccountState,
  readEvmWalletConnectedFromAccountState,
  readReownProjectId,
} from "@/reown/evmAppKit"

class ReownModalOpenFailed extends Data.TaggedError("ReownModalOpenFailed")<{
  readonly cause: unknown
}> {}

/**
 * Connects the user's main EVM wallet via Reown AppKit. Sets mainAddress for
 * read-only Hyperliquid balance/position loads -- no private keys involved.
 *
 * AppKit is prefetched on pointer enter and fully loaded on click so the
 * initial Portfolio bundle does not include Reown.
 */
export const WalletInlineConnect = (): JSX.Element => {
  const { setMainAddress, mainAddress } = useWallet()
  const [isOpening, setIsOpening] = createSignal(false)
  let unsubscribeAccount: (() => void) | undefined

  const projectIdConfigured = () => readReownProjectId() !== null

  onCleanup(() => {
    unsubscribeAccount?.()
  })

  const attachAccountListener = (
    modal: NonNullable<Awaited<ReturnType<typeof ensureEvmAppKit>>>,
  ) => {
    unsubscribeAccount?.()
    unsubscribeAccount = modal.subscribeAccount(accountState => {
      const nextAddress = readEvmAddressFromAccountState(accountState)
      const connected =
        readEvmWalletConnectedFromAccountState(accountState) ||
        nextAddress !== null

      if (connected && nextAddress) {
        setMainAddress(nextAddress)
        return
      }

      const stored = getStoredWalletAddresses()
      setMainAddress(stored?.accountAddress ?? null)
    }, "eip155")
  }

  const openConnectModal = () => {
    if (isOpening()) {
      return
    }

    if (!projectIdConfigured()) {
      toast.error("Set VITE_REOWN_PROJECT_ID in .env to connect a wallet.")
      return
    }

    setIsOpening(true)
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

        attachAccountListener(modal)
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
        Effect.ensuring(Effect.sync(() => setIsOpening(false))),
      ),
    )
  }

  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-4 text-[16px] text-muted-foreground">
      <p class="max-w-[45ch] text-center font-medium text-foreground">
        Connect wallet to load your Hyperliquid portfolio
      </p>
      <p class="max-w-[45ch] text-center text-[12px] leading-snug">
        Connect your main EVM wallet with Reown. Positions load read-only. Use
        Connect to Hyperliquid on staged changes to authorize a trading agent.
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
            onClick={openConnectModal}
          >
            {isOpening() ? "Loading wallet..." : "Connect wallet"}
          </Button>
        </Show>
      </Show>
    </div>
  )
}
