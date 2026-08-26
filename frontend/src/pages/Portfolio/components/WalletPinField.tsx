import type { JSX } from "solid-js"

import { Input } from "@/components/ui/input"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"

type WalletPinInputProps = {
  "id": string
  "value": string
  "disabled"?: boolean
  "placeholder"?: string
  "class"?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  "ref"?: (element: HTMLInputElement) => void
  "onChange": (pin: string) => void
  "onSubmit"?: () => void
  "onAnimationEnd"?: (
    event: AnimationEvent & { currentTarget: HTMLInputElement },
  ) => void
  /** Extra DOM attributes (e.g. keyboard focus data-*). */
  "extraAttributes"?: Record<string, string>
}

/**
 * Thin controlled 6-digit PIN input (password + numeric + normalize).
 * Dialog/unlock wrappers own layout and submit policy.
 */
export const WalletPinInput = (props: WalletPinInputProps): JSX.Element => (
  <Input
    id={props.id}
    ref={props.ref}
    type="password"
    inputmode="numeric"
    autocomplete="one-time-code"
    placeholder={props.placeholder ?? "6-digit PIN"}
    maxlength={WALLET_PIN_LENGTH}
    value={props.value}
    disabled={props.disabled === true}
    aria-label={props["aria-label"]}
    aria-invalid={props["aria-invalid"]}
    aria-describedby={props["aria-describedby"]}
    class={props.class ?? "h-9 font-mono tracking-[0.3em]"}
    {...(props.extraAttributes ?? {})}
    onAnimationEnd={props.onAnimationEnd}
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
)

/**
 * Labeled PIN field for dialogs (create / enter).
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
    <WalletPinInput
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
    />
  </div>
)

export { WALLET_PIN_LENGTH }
