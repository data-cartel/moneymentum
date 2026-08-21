import { createSignal, Show, type JSX } from "solid-js"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { toast } from "solid-sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import { prefetchEvmAppKit } from "@/reown/evmAppKit"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"

export type WalletPinDialogMode = "authorize" | "unlock"

interface WalletPinDialogProps {
  open: boolean
  mode: WalletPinDialogMode
  onOpenChange: (open: boolean) => void
  /** Called after a successful authorize or unlock. */
  onSuccess?: () => void
}

/**
 * Standard PIN confirmation popup used before authorizing a Hyperliquid agent
 * or unlocking an encrypted agent session after reload.
 */
export const WalletPinDialog = (props: WalletPinDialogProps): JSX.Element => {
  const { authorizeAgent, unlock } = useWallet()
  const [pin, setPin] = createSignal("")
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  const title = () =>
    props.mode === "authorize"
      ? "Connect to Hyperliquid"
      : "Unlock trading agent"

  const description = () =>
    props.mode === "authorize"
      ? "Enter a 6-digit local PIN to encrypt the new API agent key, then approve the agent in your wallet."
      : "Enter your 6-digit local PIN to decrypt the stored API agent key."

  const resetForm = () => {
    setPin("")
    setErrorMessage(null)
    setIsSubmitting(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && isSubmitting()) {
      return
    }
    if (!open) {
      resetForm()
    }
    props.onOpenChange(open)
  }

  const submitPin = async () => {
    const enteredPin = pin()
    if (enteredPin.length !== WALLET_PIN_LENGTH || isSubmitting()) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    if (props.mode === "authorize") {
      const authorizeResult = await Effect.runPromise(
        Effect.either(authorizeAgent(enteredPin)),
      )

      if (Either.isLeft(authorizeResult)) {
        console.error(
          "Failed to authorize Hyperliquid agent:",
          authorizeResult.left,
        )
        setErrorMessage(getErrorMessage(authorizeResult.left))
        setPin("")
        setIsSubmitting(false)
        return
      }

      toast.success("Hyperliquid agent connected")
      resetForm()
      props.onOpenChange(false)
      props.onSuccess?.()
      return
    }

    const unlockResult = await Effect.runPromise(
      Effect.either(unlock(enteredPin)),
    )

    if (Either.isLeft(unlockResult)) {
      console.error("Failed to unlock wallet:", unlockResult.left)
      setErrorMessage(getErrorMessage(unlockResult.left))
      setPin("")
      setIsSubmitting(false)
      return
    }

    toast.success("Wallet unlocked")
    resetForm()
    props.onOpenChange(false)
    props.onSuccess?.()
  }

  const primaryLabel = () => {
    if (isSubmitting()) {
      return props.mode === "authorize" ? "Loading wallet..." : "Unlocking..."
    }
    return props.mode === "authorize" ? "Continue" : "Unlock"
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title()}</DialogTitle>
          <DialogDescription>{description()}</DialogDescription>
        </DialogHeader>
        <div class="space-y-2">
          <label for="walletPinDialogInput" class="text-sm font-medium">
            Local PIN ({String(WALLET_PIN_LENGTH)} digits)
          </label>
          <Input
            id="walletPinDialogInput"
            type="password"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="6-digit PIN"
            maxlength={WALLET_PIN_LENGTH}
            value={pin()}
            disabled={isSubmitting()}
            class="h-9 font-mono tracking-[0.3em]"
            onInput={event => {
              setPin(normalizeWalletPinInput(event.currentTarget.value))
              setErrorMessage(null)
            }}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault()
                void submitPin()
              }
            }}
          />
          <Show when={errorMessage()}>
            <p class="text-sm text-destructive">{errorMessage()}</p>
          </Show>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting()}
            onClick={() => {
              handleOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            class="transition-opacity"
            classList={{ "opacity-50": isSubmitting() }}
            disabled={isSubmitting() || pin().length !== WALLET_PIN_LENGTH}
            onPointerEnter={() => {
              if (props.mode === "authorize") {
                prefetchEvmAppKit()
              }
            }}
            onClick={() => {
              void submitPin()
            }}
          >
            {primaryLabel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
