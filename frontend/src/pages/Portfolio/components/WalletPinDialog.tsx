import { createMemo, createSignal, Show, type JSX } from "solid-js"
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
import { hasSharedWalletPin } from "@/contexts/wallet-context"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import { hasLiveEip1193Provider, prefetchEvmAppKit } from "@/reown/evmAppKit"
import { WALLET_PIN_LENGTH } from "@/services/walletCredentialCrypto"

import { WalletPinField } from "./WalletPinField"

export type WalletPinDialogMode = "authorize" | "unlock" | "confirm"

interface WalletPinConfirmConfig {
  title: string
  description: string
  submitLabel?: string
  submittingLabel?: string
  successToast?: string
  onConfirm: (pin: string) => Effect.Effect<void, unknown>
}

interface WalletPinDialogProps {
  open: boolean
  mode: WalletPinDialogMode
  onOpenChange: (open: boolean) => void
  /** Called after a successful authorize, unlock, or confirm. */
  onSuccess?: () => void
  /** Required when mode is "confirm". */
  confirm?: WalletPinConfirmConfig
}

interface WalletPinModeConfig {
  title: string
  description: string
  pinLabel: string
  submitLabel: string
  submittingLabel: string
  successMessage: string | undefined
  action: (enteredPin: string) => Effect.Effect<void, unknown>
}

/**
 * PIN dialog for Hyperliquid agent authorize/unlock, or a caller-supplied
 * confirm action (e.g. encrypt a Derive session with the shared local PIN).
 *
 * Mode copy + Effect action live in one config switch; submit is shared.
 */
export const WalletPinDialog = (props: WalletPinDialogProps): JSX.Element => {
  const { authorizeAgent, unlock } = useWallet()
  const [pin, setPin] = createSignal("")
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  const modeConfig = createMemo((): WalletPinModeConfig => {
    const pinAlreadyExists = hasSharedWalletPin()
    const defaultPinLabel = pinAlreadyExists
      ? "PIN"
      : `Local PIN (${String(WALLET_PIN_LENGTH)} digits)`

    switch (props.mode) {
      case "confirm": {
        const confirmConfig = props.confirm
        return {
          title: confirmConfig?.title ?? "Enter local PIN",
          description: confirmConfig?.description ?? "",
          pinLabel: defaultPinLabel,
          submitLabel: confirmConfig?.submitLabel ?? "Continue",
          submittingLabel: confirmConfig?.submittingLabel ?? "Working...",
          successMessage: confirmConfig?.successToast,
          action: enteredPin =>
            confirmConfig?.onConfirm(enteredPin) ??
            Effect.fail(new Error("PIN confirm handler is missing.")),
        }
      }
      case "unlock":
        return {
          title: "Unlock trading agent",
          description:
            "Enter your 6-digit local PIN to decrypt the stored API agent key.",
          pinLabel: "PIN",
          submitLabel: "Unlock",
          submittingLabel: "Unlocking...",
          successMessage: "Wallet unlocked",
          action: enteredPin => unlock(enteredPin),
        }
      case "authorize":
        return {
          title: pinAlreadyExists ? "Enter local PIN" : "Create local PIN",
          description: pinAlreadyExists
            ? "Enter the same 6-digit PIN already set for this browser, then approve the API agent in your wallet."
            : "Choose a 6-digit local PIN to encrypt the new API agent key, then approve the agent in your wallet.",
          pinLabel: defaultPinLabel,
          submitLabel: "Continue",
          submittingLabel: "Loading wallet...",
          successMessage: "Hyperliquid agent connected",
          action: enteredPin =>
            Effect.tryPromise({
              try: () => hasLiveEip1193Provider(),
              catch: cause =>
                cause instanceof Error ? cause : new Error(String(cause)),
            }).pipe(
              Effect.flatMap(providerIsLive =>
                providerIsLive
                  ? authorizeAgent(enteredPin)
                  : Effect.fail(
                      new Error(
                        "Connect your Hyperliquid wallet first, then approve the agent.",
                      ),
                    ),
              ),
            ),
        }
    }
  })

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

    const { action, successMessage } = modeConfig()
    const result = await Effect.runPromise(Effect.either(action(enteredPin)))

    if (Either.isLeft(result)) {
      console.error(`Failed to ${props.mode} with PIN:`, result.left)
      setErrorMessage(getErrorMessage(result.left))
      setPin("")
      setIsSubmitting(false)
      return
    }

    if (successMessage !== undefined) {
      toast.success(successMessage)
    }
    resetForm()
    props.onOpenChange(false)
    props.onSuccess?.()
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>{modeConfig().title}</DialogTitle>
          <DialogDescription>{modeConfig().description}</DialogDescription>
        </DialogHeader>
        <div class="space-y-2">
          <WalletPinField
            id="walletPinDialogInput"
            label={modeConfig().pinLabel}
            value={pin()}
            disabled={isSubmitting()}
            onChange={nextPin => {
              setPin(nextPin)
              setErrorMessage(null)
            }}
            onSubmit={() => {
              void submitPin()
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
            {isSubmitting()
              ? modeConfig().submittingLabel
              : modeConfig().submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
