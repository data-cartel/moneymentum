import { createSignal, onMount, Show, type JSX } from "solid-js"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"

import { Input } from "@/components/ui/input"
import { getStoredEncryptedSession } from "@/contexts/wallet-context"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"

const formatWalletAddress = (address: string): string => {
  if (!address || address.length < 10) {
    return address
  }
  if (address.startsWith("0x")) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

export const WalletInlinePinUnlock = (): JSX.Element => {
  const { unlock } = useWallet()
  const [pin, setPin] = createSignal("")
  const [unlockError, setUnlockError] = createSignal<string | null>(null)
  const [isUnlocking, setIsUnlocking] = createSignal(false)
  let pinInputRef: HTMLInputElement | undefined

  const focusPinInput = () => {
    pinInputRef?.focus()
  }

  onMount(() => {
    focusPinInput()
  })

  const walletAddress = () =>
    formatWalletAddress(getStoredEncryptedSession()?.accountAddress ?? "wallet")

  const attemptUnlock = async (enteredPin: string) => {
    if (enteredPin.length !== WALLET_PIN_LENGTH || isUnlocking()) {
      return
    }

    setIsUnlocking(true)
    setUnlockError(null)

    const unlockResult = await Effect.runPromise(
      Effect.either(unlock(enteredPin)),
    )

    if (Either.isRight(unlockResult)) {
      setPin("")
    } else {
      setPin("")
      console.error("Failed to unlock wallet:", unlockResult.left)
      setUnlockError(getErrorMessage(unlockResult.left))
    }

    setIsUnlocking(false)
    focusPinInput()
  }

  return (
    <div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground text-[11px]">
      <p class="max-w-[320px]">
        To continue using your wallet{" "}
        <span class="font-mono text-foreground">{walletAddress()}</span> enter
        PIN
      </p>
      <div class="flex w-full max-w-[240px] flex-col gap-2 text-left">
        <label for="portfolioWalletPin" class="sr-only">
          Local PIN
        </label>
        <Input
          ref={pinInputRef}
          id="portfolioWalletPin"
          type="password"
          inputmode="numeric"
          autocomplete="current-password"
          placeholder="6-digit PIN"
          maxlength={WALLET_PIN_LENGTH}
          value={pin()}
          disabled={isUnlocking()}
          class="h-8 text-center font-mono text-[12px] tracking-[0.3em]"
          onInput={event => {
            const nextPin = normalizeWalletPinInput(event.currentTarget.value)
            setPin(nextPin)
            setUnlockError(null)
            if (nextPin.length === WALLET_PIN_LENGTH) {
              void attemptUnlock(nextPin)
            }
          }}
        />
        <Show when={unlockError()}>
          <p class="text-center text-destructive text-[11px]">
            {unlockError()}
          </p>
        </Show>
      </div>
    </div>
  )
}
