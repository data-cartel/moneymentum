import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { toast } from "solid-sonner"

import { Input } from "@/components/ui/input"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"
import {
  STAGED_PIN_ATTR,
  tryUsePortfolioKeyboardContext,
} from "@/pages/Portfolio/keyboard"

const PIN_SHAKE_CLASS = "animate-pin-shake"

/**
 * Shared local-PIN unlock field for Hyperliquid agent + Derive session
 * (same `unlock` decrypts both). Auto-submits at 6 digits.
 */
export const SessionPinUnlockField = (props: {
  placeholder: string
  inputId: string
  disabled?: boolean
  /** When true, focus + select the input (e.g. staged panel focused). */
  autofocus?: boolean
  successMessage?: string
  onUnlocked?: () => void
  /** Register Cmd/Ctrl+Enter with the staged keyboard workflow. */
  registerStagedSubmit?: boolean
  /** Optional data-* attribute for keyboard focus helpers (e.g. Derive pin). */
  focusDataAttr?: string
  class?: string
}): JSX.Element => {
  const { unlock } = useWallet()
  const keyboard = tryUsePortfolioKeyboardContext()
  const [pin, setPin] = createSignal("")
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isUnlocking, setIsUnlocking] = createSignal(false)
  let pinInput: HTMLInputElement | undefined

  const errorId = () => `${props.inputId}Error`

  const shakePinField = () => {
    const inputElement = pinInput
    if (!inputElement) {
      return
    }

    inputElement.classList.remove(PIN_SHAKE_CLASS)
    // Force a reflow so the same animation can restart on repeated failures.
    void inputElement.offsetWidth
    inputElement.classList.add(PIN_SHAKE_CLASS)
    inputElement.focus()
    inputElement.select()
  }

  const submitUnlock = async (pinOverride?: string) => {
    const enteredPin = pinOverride ?? pin()
    if (
      enteredPin.length !== WALLET_PIN_LENGTH ||
      isUnlocking() ||
      props.disabled === true
    ) {
      return
    }

    setIsUnlocking(true)

    const unlockResult = await Effect.runPromise(
      Effect.either(unlock(enteredPin)),
    )

    if (Either.isLeft(unlockResult)) {
      console.error("Failed to unlock wallet:", unlockResult.left)
      setErrorMessage(getErrorMessage(unlockResult.left))
      setIsUnlocking(false)
      shakePinField()
      return
    }

    toast.success(props.successMessage ?? "Wallet unlocked")
    setPin("")
    setErrorMessage(null)
    setIsUnlocking(false)
    props.onUnlocked?.()
  }

  // Ref so keyboard registration does not close over a reactive callback (solid/reactivity).
  const submitUnlockForKeyboard: {
    current: (pinOverride?: string) => Promise<void>
  } = { current: submitUnlock }
  submitUnlockForKeyboard.current = submitUnlock

  // createEffect: focus when the host requests autofocus (panel activation).
  createEffect(() => {
    if (props.autofocus !== true) {
      return
    }
    queueMicrotask(() => {
      pinInput?.focus()
      pinInput?.select()
    })
  })

  // createEffect: optional Cmd/Ctrl+Enter submit for staged keyboard flow.
  createEffect(() => {
    if (props.registerStagedSubmit !== true || !keyboard) {
      return
    }
    keyboard.registerStagedUnlockSubmit(() => {
      void submitUnlockForKeyboard.current()
    })
    onCleanup(() => {
      keyboard.registerStagedUnlockSubmit(null)
    })
  })

  return (
    <div class={props.class ?? "space-y-1"}>
      <Input
        id={props.inputId}
        ref={element => {
          pinInput = element
        }}
        type="password"
        inputmode="numeric"
        autocomplete="one-time-code"
        placeholder={props.placeholder}
        maxlength={WALLET_PIN_LENGTH}
        value={pin()}
        disabled={props.disabled === true || isUnlocking()}
        aria-label={props.placeholder}
        aria-invalid={errorMessage() !== null}
        aria-describedby={errorMessage() !== null ? errorId() : undefined}
        class="h-8 font-mono text-[11px] tracking-[0.25em] placeholder:tracking-normal placeholder:font-sans"
        {...(props.registerStagedSubmit === true
          ? { [STAGED_PIN_ATTR]: "" }
          : {})}
        {...(props.focusDataAttr !== undefined
          ? { [props.focusDataAttr]: "" }
          : {})}
        onAnimationEnd={event => {
          event.currentTarget.classList.remove(PIN_SHAKE_CLASS)
        }}
        onInput={event => {
          const nextPin = normalizeWalletPinInput(event.currentTarget.value)
          setPin(nextPin)
          setErrorMessage(null)
          if (nextPin.length === WALLET_PIN_LENGTH) {
            void submitUnlock(nextPin)
          }
        }}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault()
            void submitUnlock()
          }
        }}
      />
      <Show when={errorMessage()}>
        <p
          id={errorId()}
          role="alert"
          class="text-[10px] leading-snug text-destructive"
        >
          {errorMessage()}
        </p>
      </Show>
    </div>
  )
}
