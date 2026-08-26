import {
  createEffect,
  createSignal,
  Show,
  type Accessor,
  type JSX,
} from "solid-js"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { toast } from "solid-sonner"

import {
  OptionsTradingView,
  useDebouncedStreamEnabled,
} from "@/components/derive-options"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getStoredEncryptedDeriveSession,
  hasSharedWalletPin,
} from "@/contexts/wallet-context"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import { MIN_USD } from "../hooks/usePortfolioState"
import { DERIVE_PIN_ATTR, tryUsePortfolioKeyboardContext } from "../keyboard"
import { tryUsePortfolioShell } from "../portfolioShellContext"
import { SessionPinUnlockField } from "./SessionPinUnlockField"
import { WalletPinDialog } from "./WalletPinDialog"

export const DERIVE_WALLET_INPUT_ATTR = "data-derive-wallet-input"

const DERIVE_UNLOCK_PIN_PLACEHOLDER = "Enter 6-digit PIN to load data"

/**
 * Derive venue tab: session credentials + live options chain.
 * Subaccount selection lives in the wallet header under Derive account.
 */
export const DerivePanel = (props: {
  isPanelVisible: Accessor<boolean>
  greeksVisible: Accessor<boolean>
  onGreeksVisibleChange: (visible: boolean) => void
  onAddOption?: (request: {
    symbol: string
    side: "buy" | "sell"
    notional: number
  }) => void
}): JSX.Element => {
  const {
    connectDerive,
    isDeriveConnected,
    isDeriveLocked,
    hasVerifiedSessionPin,
    hasStoredDeriveSession,
    networkMode,
  } = useWallet()
  const shell = tryUsePortfolioShell()
  const keyboard = tryUsePortfolioKeyboardContext()
  const streamEnabled = useDebouncedStreamEnabled(() => props.isPanelVisible())

  const [deriveWalletInput, setDeriveWalletInput] = createSignal("")
  const [sessionKeyInput, setSessionKeyInput] = createSignal("")
  const [pinDialogOpen, setPinDialogOpen] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  const [deriveUnlockFocused, setDeriveUnlockFocused] = createSignal(false)
  let walletInputElement: HTMLInputElement | undefined

  const pinAlreadyExists = () => hasSharedWalletPin()
  const canReuseSessionPin = () => hasVerifiedSessionPin()

  const otherNetworkSessionLabel = (): string | null => {
    if (!hasStoredDeriveSession() || isDeriveConnected()) {
      return null
    }
    const storedNetwork = getStoredEncryptedDeriveSession()?.networkMode ?? null
    if (storedNetwork === null || storedNetwork === networkMode()) {
      return null
    }
    return storedNetwork
  }

  // createEffect: focus PIN when Derive panel is active and session is locked.
  createEffect(() => {
    setDeriveUnlockFocused(
      keyboard?.focusedPanel() === "derive" && isDeriveLocked(),
    )
  })

  // createEffect: focus wallet field when shell requests Derive focus.
  createEffect(() => {
    const request = shell?.focusVenueRequest()
    if (request?.venue !== "derive" || !request.focusWalletField) {
      return
    }
    queueMicrotask(() => {
      walletInputElement?.focus()
      shell?.clearFocusVenueRequest()
    })
  })

  const connectFormReady = () =>
    deriveWalletInput().trim() !== "" && sessionKeyInput().trim() !== ""

  const runConnectWithoutPrompt = async () => {
    if (isSubmitting() || !connectFormReady()) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    const result = await Effect.runPromise(
      Effect.either(
        connectDerive(
          {
            deriveWallet: deriveWalletInput(),
            sessionPrivateKey: sessionKeyInput(),
          },
          undefined,
        ),
      ),
    )

    if (Either.isLeft(result)) {
      setErrorMessage(getErrorMessage(result.left))
      setIsSubmitting(false)
      return
    }

    toast.success("Derive session connected")
    setSessionKeyInput("")
    setIsSubmitting(false)
  }

  const beginConnect = () => {
    if (isSubmitting() || !connectFormReady()) {
      return
    }

    if (pinAlreadyExists() && canReuseSessionPin()) {
      void runConnectWithoutPrompt()
      return
    }

    setErrorMessage(null)
    setPinDialogOpen(true)
  }

  const pinConfirmCopy = () =>
    pinAlreadyExists()
      ? {
          title: "Enter local PIN",
          description:
            "Use the same 6-digit PIN already set for this browser to encrypt the Derive session key.",
        }
      : {
          title: "Create local PIN",
          description:
            "Choose a 6-digit local PIN to encrypt the Derive session key.",
        }

  const optionsStreamEnabled = (): boolean =>
    isDeriveConnected() && !isDeriveLocked() && streamEnabled()

  return (
    <div
      class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col outline-none"
      tabIndex={0}
      data-portfolio-panel="derive"
    >
      <Show
        when={isDeriveConnected()}
        fallback={
          <div class="flex max-w-xl flex-col gap-3 overflow-auto p-4">
            <div class="space-y-1">
              <h2 class="text-sm font-semibold text-foreground">Derive</h2>
              <p class="max-w-[60ch] text-[12px] leading-snug text-muted-foreground">
                Paste your Derive Wallet and session key private key from the
                Derive developers page for{" "}
                {networkMode() === "testnet" ? "testnet" : "mainnet"}. Keys are
                encrypted locally with your PIN.
              </p>
              <Show when={otherNetworkSessionLabel()}>
                {otherNetwork => (
                  <p class="max-w-[60ch] text-[12px] leading-snug text-amber-600 dark:text-amber-400">
                    A session is stored for {otherNetwork()}. Switch the Testnet
                    toggle back, or connect a new session for {networkMode()}.
                  </p>
                )}
              </Show>
            </div>
            <div class="space-y-1">
              <label class="text-[12px] font-medium" for="deriveWalletInput">
                Derive Wallet
              </label>
              <Input
                id="deriveWalletInput"
                ref={element => {
                  walletInputElement = element
                }}
                class="h-9 font-mono text-[12px]"
                placeholder="0x..."
                value={deriveWalletInput()}
                disabled={isSubmitting()}
                {...{ [DERIVE_WALLET_INPUT_ATTR]: "" }}
                onInput={event => {
                  setDeriveWalletInput(event.currentTarget.value)
                  setErrorMessage(null)
                }}
              />
            </div>
            <div class="space-y-1">
              <label
                class="text-[12px] font-medium"
                for="deriveSessionKeyInput"
              >
                Session Key private key
              </label>
              <Input
                id="deriveSessionKeyInput"
                type="password"
                class="h-9 font-mono text-[12px]"
                placeholder="0x..."
                value={sessionKeyInput()}
                disabled={isSubmitting()}
                onInput={event => {
                  setSessionKeyInput(event.currentTarget.value)
                  setErrorMessage(null)
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    beginConnect()
                  }
                }}
              />
            </div>
            <Show when={errorMessage()}>
              <p class="text-sm text-destructive">{errorMessage()}</p>
            </Show>
            <Button
              type="button"
              class="h-8 w-fit transition-opacity"
              classList={{ "opacity-50": isSubmitting() }}
              disabled={isSubmitting() || !connectFormReady()}
              onClick={beginConnect}
            >
              {isSubmitting() ? "Connecting..." : "Connect Derive"}
            </Button>
          </div>
        }
      >
        <Show
          when={!isDeriveLocked()}
          fallback={
            <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
              <p class="max-w-[36ch] text-center text-[12px] leading-snug text-muted-foreground">
                Derive session is locked. Enter your PIN to load account data.
              </p>
              <SessionPinUnlockField
                inputId="deriveSessionUnlockPin"
                placeholder={DERIVE_UNLOCK_PIN_PLACEHOLDER}
                class="w-full max-w-[24ch] space-y-1"
                successMessage="Derive session unlocked"
                autofocus={deriveUnlockFocused()}
                focusDataAttr={DERIVE_PIN_ATTR}
              />
            </div>
          }
        >
          <div class="min-h-0 flex-1 overflow-hidden">
            <OptionsTradingView
              streamEnabled={optionsStreamEnabled}
              networkMode={networkMode}
              greeksLayout={{
                visible: props.greeksVisible,
                setVisible: props.onGreeksVisibleChange,
              }}
              minNotional={MIN_USD}
              onAddOption={props.onAddOption}
            />
          </div>
        </Show>
      </Show>

      <WalletPinDialog
        open={pinDialogOpen()}
        mode="confirm"
        onOpenChange={setPinDialogOpen}
        confirm={{
          ...pinConfirmCopy(),
          submitLabel: "Continue",
          submittingLabel: "Connecting...",
          successToast: "Derive session connected",
          onConfirm: enteredPin =>
            connectDerive(
              {
                deriveWallet: deriveWalletInput(),
                sessionPrivateKey: sessionKeyInput(),
              },
              enteredPin,
            ).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  setSessionKeyInput("")
                }),
              ),
            ),
        }}
      />
    </div>
  )
}
