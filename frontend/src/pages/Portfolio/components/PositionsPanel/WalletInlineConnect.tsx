import { createMemo, createSignal, onMount, type JSX } from "solid-js"
import * as Effect from "effect/Effect"
import { toast } from "solid-sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getStoredWalletAddresses } from "@/contexts/wallet-context"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"

export const WalletInlineConnect = (): JSX.Element => {
  const { connect } = useWallet()
  const [accountAddress, setAccountAddress] = createSignal("")
  const [apiWalletAddress, setApiWalletAddress] = createSignal("")
  const [privateKey, setPrivateKey] = createSignal("")
  const [pin, setPin] = createSignal("")
  const [isConnecting, setIsConnecting] = createSignal(false)

  onMount(() => {
    const stored = getStoredWalletAddresses()
    if (!stored) {
      return
    }

    setAccountAddress(stored.accountAddress)
    setApiWalletAddress(stored.apiWalletAddress)
  })

  const canConnect = createMemo(
    () =>
      accountAddress().trim() !== "" &&
      apiWalletAddress().trim() !== "" &&
      privateKey().trim() !== "" &&
      pin().length === WALLET_PIN_LENGTH,
  )

  const handleConnect = async () => {
    if (!canConnect()) {
      return
    }
    const credentials = {
      accountAddress: accountAddress().trim(),
      apiWalletAddress: apiWalletAddress().trim(),
      privateKey: privateKey().trim(),
    }

    setIsConnecting(true)
    try {
      await Effect.runPromise(connect(credentials, pin()))
      setPrivateKey("")
      setPin("")
      toast.success("Wallet connected")
    } catch (error) {
      console.error("Failed to encrypt and store wallet credentials:", error)
      toast.error(getErrorMessage(error))
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-4 text-[16px] text-muted-foreground">
      <p class="max-w-[45ch] text-center font-medium text-foreground">
        Connect Hyperliquid wallet to rebalance your portfolio
      </p>
      <div class="flex w-full max-w-[45ch] flex-col gap-3 text-left">
        <div class="space-y-1.5">
          <label for="portfolioAccountAddress" class="font-medium">
            Hyperliquid main wallet address
          </label>
          <Input
            id="portfolioAccountAddress"
            placeholder="0x..."
            value={accountAddress()}
            disabled={isConnecting()}
            class="h-8 text-[12px]"
            onInput={event => {
              setAccountAddress(event.currentTarget.value)
            }}
          />
        </div>
        <div class="space-y-1.5">
          <label for="portfolioApiWalletAddress" class="font-medium">
            Hyperliquid public API wallet address
          </label>
          <Input
            id="portfolioApiWalletAddress"
            placeholder="0x..."
            value={apiWalletAddress()}
            disabled={isConnecting()}
            class="h-8 text-[12px]"
            onInput={event => {
              setApiWalletAddress(event.currentTarget.value)
            }}
          />
        </div>
        <div class="space-y-1.5">
          <label for="portfolioPrivateKey" class="font-medium">
            Hyperliquid private API wallet key
          </label>
          <Input
            id="portfolioPrivateKey"
            type="password"
            placeholder="0x..."
            value={privateKey()}
            disabled={isConnecting()}
            class="h-8 text-[12px]"
            onInput={event => {
              setPrivateKey(event.currentTarget.value)
            }}
          />
        </div>
        <div class="space-y-1.5">
          <label for="portfolioConnectPin" class="font-medium">
            Local PIN ({String(WALLET_PIN_LENGTH)} characters)
          </label>
          <Input
            id="portfolioConnectPin"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            placeholder="6-digit PIN"
            maxlength={WALLET_PIN_LENGTH}
            value={pin()}
            disabled={isConnecting()}
            class="h-8 text-[12px] font-mono tracking-[0.3em]"
            onInput={event => {
              setPin(normalizeWalletPinInput(event.currentTarget.value))
            }}
            onKeyDown={event => {
              if (event.key === "Enter" && canConnect()) {
                event.preventDefault()
                void handleConnect()
              }
            }}
          />
        </div>
        <Button
          type="button"
          class="h-8 text-[12px]"
          disabled={isConnecting() || !canConnect()}
          onClick={() => {
            void handleConnect()
          }}
        >
          Connect
        </Button>
      </div>
    </div>
  )
}
