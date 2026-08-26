import type { JSX } from "solid-js"

import { Input } from "@/components/ui/input"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"

/**
 * Shared 6-digit local-PIN input (create / enter). Auto-normalizes digits.
 */
export const WalletPinField = (props: {
  id: string
  label: string
  value: string
  disabled?: boolean
  onChange: (pin: string) => void
  onSubmit?: () => void
}): JSX.Element => (
  <div class="space-y-2">
    <label for={props.id} class="text-sm font-medium">
      {props.label}
    </label>
    <Input
      id={props.id}
      type="password"
      inputmode="numeric"
      autocomplete="one-time-code"
      placeholder="6-digit PIN"
      maxlength={WALLET_PIN_LENGTH}
      value={props.value}
      disabled={props.disabled === true}
      class="h-9 font-mono tracking-[0.3em]"
      onInput={event => {
        props.onChange(normalizeWalletPinInput(event.currentTarget.value))
      }}
      onKeyDown={event => {
        if (event.key === "Enter") {
          event.preventDefault()
          props.onSubmit?.()
        }
      }}
    />
  </div>
)
