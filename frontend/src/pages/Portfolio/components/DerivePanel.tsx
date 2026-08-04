import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  type JSX,
} from "solid-js"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { hasSharedWalletPin } from "@/contexts/wallet-context"
import { useWallet } from "@/hooks/useWallet"
import { useDeriveAccountSnapshot } from "@/hooks/useTrading"
import { getErrorMessage } from "@/lib/error-message"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"
import { tryUsePortfolioShell } from "../portfolioShellContext"

interface SubaccountOption {
  id: number
  label: string
}

export const DERIVE_WALLET_INPUT_ATTR = "data-derive-wallet-input"

const formatUsd = (value: number): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

/**
 * Derive venue tab: Developers session credentials + subaccount picker.
 * Account reads need the session key unlocked; trading PIN for HL stays on staged.
 */
export const DerivePanel = (): JSX.Element => {
  const {
    connectDerive,
    unlock,
    disconnectDerive,
    isDeriveConnected,
    isDeriveLocked,
    deriveCredentials,
    setDeriveSubaccountId,
    hasVerifiedSessionPin,
  } = useWallet()
  const shell = tryUsePortfolioShell()
  const accountSnapshot = useDeriveAccountSnapshot()

  const [deriveWalletInput, setDeriveWalletInput] = createSignal("")
  const [sessionKeyInput, setSessionKeyInput] = createSignal("")
  const [pin, setPin] = createSignal("")
  const [existingPinDialogOpen, setExistingPinDialogOpen] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)
  const [isSubmitting, setIsSubmitting] = createSignal(false)
  let walletInputElement: HTMLInputElement | undefined

  const pinAlreadyExists = () => hasSharedWalletPin()
  const canReuseSessionPin = () => hasVerifiedSessionPin()

  const subaccountOptions = createMemo((): SubaccountOption[] => {
    const snapshot = accountSnapshot.data
    const owner = deriveCredentials()?.deriveWallet ?? ""
    if (snapshot === undefined) {
      return []
    }

    return snapshot.subaccounts.map(subaccount => {
      const balance = Number.parseFloat(subaccount.subaccountValue)
      const balanceLabel = Number.isFinite(balance)
        ? formatUsd(balance)
        : subaccount.subaccountValue
      return {
        id: subaccount.subaccountId,
        label: `${owner} #${String(subaccount.subaccountId)} ($${balanceLabel})`,
      }
    })
  })

  const selectedSubaccount = createMemo(() => {
    const selectedId = deriveCredentials()?.subaccountId
    if (selectedId === null || selectedId === undefined) {
      return null
    }
    return subaccountOptions().find(option => option.id === selectedId) ?? null
  })

  // createEffect: auto-select first subaccount when none is chosen.
  createEffect(() => {
    const options = subaccountOptions()
    const current = deriveCredentials()?.subaccountId
    if (options.length === 0) {
      return
    }
    if (current !== null && current !== undefined) {
      const stillValid = options.some(option => option.id === current)
      if (stillValid) {
        return
      }
    }
    const first = options[0]
    setDeriveSubaccountId(first.id)
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

  const runConnect = async (enteredPin: string | undefined) => {
    if (
      isSubmitting() ||
      deriveWalletInput().trim() === "" ||
      sessionKeyInput().trim() === ""
    ) {
      return
    }

    if (enteredPin !== undefined && enteredPin.length !== WALLET_PIN_LENGTH) {
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
          enteredPin,
        ),
      ),
    )

    if (Either.isLeft(result)) {
      setErrorMessage(getErrorMessage(result.left))
      setPin("")
      setIsSubmitting(false)
      return
    }

    toast.success("Derive session connected")
    setSessionKeyInput("")
    setPin("")
    setExistingPinDialogOpen(false)
    setIsSubmitting(false)
  }

  const beginConnect = () => {
    if (
      isSubmitting() ||
      deriveWalletInput().trim() === "" ||
      sessionKeyInput().trim() === ""
    ) {
      return
    }

    if (pinAlreadyExists()) {
      if (canReuseSessionPin()) {
        void runConnect(undefined)
        return
      }
      setPin("")
      setErrorMessage(null)
      setExistingPinDialogOpen(true)
      return
    }

    void runConnect(pin())
  }

  const submitUnlock = async () => {
    const enteredPin = pin()
    if (enteredPin.length !== WALLET_PIN_LENGTH || isSubmitting()) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    const result = await Effect.runPromise(Effect.either(unlock(enteredPin)))
    if (Either.isLeft(result)) {
      setErrorMessage(getErrorMessage(result.left))
      setPin("")
      setIsSubmitting(false)
      return
    }

    toast.success("Derive session unlocked")
    setPin("")
    setIsSubmitting(false)
  }

  const onDisconnect = () => {
    void Effect.runPromise(
      disconnectDerive().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            toast.success("Derive disconnected")
            setDeriveWalletInput("")
            setSessionKeyInput("")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
      ),
    )
  }

  const connectFormReady = () =>
    deriveWalletInput().trim() !== "" && sessionKeyInput().trim() !== ""

  const createPinReady = () =>
    pinAlreadyExists() || pin().length === WALLET_PIN_LENGTH

  return (
    <div
      class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-auto p-4 outline-none"
      tabIndex={0}
      data-portfolio-panel="derive"
    >
      <div class="space-y-1">
        <h2 class="text-sm font-semibold text-foreground">Derive</h2>
        <p class="max-w-[60ch] text-[12px] leading-snug text-muted-foreground">
          Paste your Derive Wallet and session key private key from the Derive
          developers page. Keys are encrypted locally with your PIN.
        </p>
      </div>

      <Show
        when={isDeriveConnected()}
        fallback={
          <div class="flex max-w-xl flex-col gap-3">
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
              />
            </div>
            <Show when={!pinAlreadyExists()}>
              <div class="space-y-1">
                <label class="text-[12px] font-medium" for="derivePinInput">
                  Create local PIN ({String(WALLET_PIN_LENGTH)} digits)
                </label>
                <Input
                  id="derivePinInput"
                  type="password"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  class="h-9 font-mono tracking-[0.3em]"
                  maxlength={WALLET_PIN_LENGTH}
                  placeholder="6-digit PIN"
                  value={pin()}
                  disabled={isSubmitting()}
                  onInput={event => {
                    setPin(normalizeWalletPinInput(event.currentTarget.value))
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
            </Show>
            <Show when={errorMessage() && !existingPinDialogOpen()}>
              <p class="text-sm text-destructive">{errorMessage()}</p>
            </Show>
            <Button
              type="button"
              class="h-8 w-fit transition-opacity"
              classList={{ "opacity-50": isSubmitting() }}
              disabled={
                isSubmitting() || !connectFormReady() || !createPinReady()
              }
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
            <div class="flex max-w-xl flex-col gap-3">
              <p class="text-[12px] text-muted-foreground">
                Derive session is locked. Enter your PIN to load account data.
              </p>
              <Input
                type="password"
                inputmode="numeric"
                autocomplete="one-time-code"
                class="h-9 max-w-[20ch] font-mono tracking-[0.3em]"
                maxlength={WALLET_PIN_LENGTH}
                placeholder="6-digit PIN"
                value={pin()}
                disabled={isSubmitting()}
                onInput={event => {
                  setPin(normalizeWalletPinInput(event.currentTarget.value))
                  setErrorMessage(null)
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void submitUnlock()
                  }
                }}
              />
              <Show when={errorMessage()}>
                <p class="text-sm text-destructive">{errorMessage()}</p>
              </Show>
              <Button
                type="button"
                class="h-8 w-fit"
                disabled={isSubmitting() || pin().length !== WALLET_PIN_LENGTH}
                onClick={() => {
                  void submitUnlock()
                }}
              >
                {isSubmitting() ? "Unlocking..." : "Unlock"}
              </Button>
            </div>
          }
        >
          <div class="flex max-w-2xl flex-col gap-3">
            <div class="space-y-1">
              <p class="text-[11px] text-muted-foreground">Derive Wallet</p>
              <p class="break-all font-mono text-[12px] text-foreground">
                {deriveCredentials()?.deriveWallet}
              </p>
            </div>

            <div class="space-y-1">
              <label class="text-[12px] font-medium">Subaccount</label>
              <Show
                when={subaccountOptions().length > 0}
                fallback={
                  <p class="text-[12px] text-muted-foreground">
                    {accountSnapshot.isLoading
                      ? "Loading subaccounts..."
                      : "No subaccounts found."}
                  </p>
                }
              >
                <Select<SubaccountOption>
                  options={subaccountOptions()}
                  optionValue="id"
                  optionTextValue="label"
                  value={selectedSubaccount()}
                  onChange={option => {
                    if (option !== null) {
                      setDeriveSubaccountId(option.id)
                    }
                  }}
                  placeholder="Select subaccount"
                  itemComponent={itemProps => (
                    <SelectItem item={itemProps.item}>
                      {itemProps.item.rawValue.label}
                    </SelectItem>
                  )}
                >
                  <SelectTrigger class="h-9 w-full max-w-2xl font-mono text-[11px]">
                    <SelectValue<SubaccountOption>>
                      {state => {
                        const selected = state.selectedOption()
                        return selected.label
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>
              </Show>
            </div>

            <Button
              type="button"
              variant="outline"
              class="h-8 w-fit"
              onClick={onDisconnect}
            >
              Disconnect Derive
            </Button>
          </div>
        </Show>
      </Show>

      <Dialog
        open={existingPinDialogOpen()}
        onOpenChange={open => {
          if (isSubmitting()) {
            return
          }
          setExistingPinDialogOpen(open)
          if (!open) {
            setPin("")
            setErrorMessage(null)
          }
        }}
      >
        <DialogContent class="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter local PIN</DialogTitle>
            <DialogDescription>
              Use the same 6-digit PIN already set for this browser to encrypt
              the Derive session key.
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-2">
            <Input
              type="password"
              inputmode="numeric"
              autocomplete="one-time-code"
              class="h-9 font-mono tracking-[0.3em]"
              maxlength={WALLET_PIN_LENGTH}
              placeholder="6-digit PIN"
              value={pin()}
              disabled={isSubmitting()}
              onInput={event => {
                setPin(normalizeWalletPinInput(event.currentTarget.value))
                setErrorMessage(null)
              }}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void runConnect(pin())
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
                setExistingPinDialogOpen(false)
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSubmitting() || pin().length !== WALLET_PIN_LENGTH}
              onClick={() => {
                void runConnect(pin())
              }}
            >
              {isSubmitting() ? "Connecting..." : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
