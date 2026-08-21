import { For, Show, createSignal } from "solid-js"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { cn } from "@/lib/cn"
import { getErrorMessage } from "@/lib/error-message"
import { Send } from "lucide-solid"
import { toast } from "solid-sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWallet } from "@/hooks/useWallet"
import type { StagedTradeItem } from "@/pages/Portfolio/hooks/usePortfolioState"
import { prefetchEvmAppKit } from "@/reown/evmAppKit"
import {
  normalizeWalletPinInput,
  WALLET_PIN_LENGTH,
} from "@/services/walletCredentialCrypto"

/** Mutually exclusive wallet/agent readiness for the staged-changes primary action. */
export type StagedConnectionState =
  | "walletDisconnected"
  | "agentMissing"
  | "agentLocked"
  | "ready"

interface StagedChangesPanelProps {
  stagedTrades: StagedTradeItem[]
  currentTotalNotional: number
  targetTotalNotional: number
  currentCrossAccountLeverage: number
  targetCrossAccountLeverage: number
  onPrimaryAction?: () => void
  /** Called after a successful inline PIN unlock (locked agent session). */
  onUnlocked?: () => void
  isRebalancing?: boolean
  canSubmit: boolean
  connectionState: StagedConnectionState
  onClearAll?: () => void
}

// Grid template for staged-change rows:
// [0] Side badge (6ch) | [1] Symbol (~JELLYJELLY width + padding) | [2] Weight change (auto) | [3] Notional (= "$2000.00")
const STAGED_ROW_GRID_TEMPLATE =
  "grid grid-cols-[6ch_13ch_auto_8ch] items-center px-2 py-1.5 border-b border-border/30 text-[10px]"

const formatUnsignedPct = (weightFraction: number): string =>
  `${(weightFraction * 100).toFixed(2)}%`

const formatUsdPrecise = (value: number): string => `$${value.toFixed(2)}`

const NOTIONAL_EPSILON_USD = 0.1
const LEVERAGE_EPSILON = 0.001

const UNLOCK_PIN_PLACEHOLDER = "Enter 6-digit PIN to rebalance"
const UNLOCK_PIN_ERROR_ID = "stagedChangesUnlockPinError"
const PIN_SHAKE_CLASS = "animate-pin-shake"

export const StagedChangesPanel = (props: StagedChangesPanelProps) => {
  const { unlock } = useWallet()
  const [unlockPin, setUnlockPin] = createSignal("")
  const [unlockError, setUnlockError] = createSignal<string | null>(null)
  const [isUnlocking, setIsUnlocking] = createSignal(false)
  let unlockPinInput: HTMLInputElement | undefined

  const stagedTrades = () => props.stagedTrades
  const hasStaged = () => stagedTrades().length > 0

  const isRebalancing = () => props.isRebalancing ?? false

  const connectionState = () => props.connectionState

  const showUnlockPinField = () => connectionState() === "agentLocked"

  const primaryLabel = () => {
    if (isRebalancing()) {
      return "Sending..."
    }
    if (
      connectionState() === "walletDisconnected" ||
      connectionState() === "agentMissing"
    ) {
      return "Connect to Hyperliquid"
    }
    return "Rebalance"
  }

  const isPrimaryDisabled = () => {
    if (isRebalancing()) {
      return true
    }
    switch (connectionState()) {
      case "walletDisconnected":
        return true
      case "agentMissing":
        return false
      case "agentLocked":
        return true
      case "ready":
        return !props.canSubmit || !hasStaged()
    }
  }

  const shakeUnlockPinField = () => {
    const inputElement = unlockPinInput
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

  const submitUnlockPin = async (pinOverride?: string) => {
    const enteredPin = pinOverride ?? unlockPin()
    if (
      enteredPin.length !== WALLET_PIN_LENGTH ||
      isUnlocking() ||
      isRebalancing()
    ) {
      return
    }

    setIsUnlocking(true)

    const unlockResult = await Effect.runPromise(
      Effect.either(unlock(enteredPin)),
    )

    if (Either.isLeft(unlockResult)) {
      console.error("Failed to unlock wallet:", unlockResult.left)
      setUnlockError(getErrorMessage(unlockResult.left))
      setIsUnlocking(false)
      shakeUnlockPinField()
      return
    }

    toast.success("Wallet unlocked")
    setUnlockPin("")
    setUnlockError(null)
    setIsUnlocking(false)
    props.onUnlocked?.()
  }

  const currentTotalNotional = () => props.currentTotalNotional
  const targetTotalNotional = () => props.targetTotalNotional
  const currentLeverage = () => props.currentCrossAccountLeverage
  const targetLeverage = () => props.targetCrossAccountLeverage

  const shouldShowNotionalArrow = () => {
    return (
      Math.abs(targetTotalNotional() - currentTotalNotional()) >=
      NOTIONAL_EPSILON_USD
    )
  }

  const shouldShowLeverageArrow = () => {
    return Math.abs(currentLeverage() - targetLeverage()) > LEVERAGE_EPSILON
  }

  return (
    <div class="flex h-full min-h-0 w-full min-w-0 flex-col">
      <Show when={hasStaged() && props.onClearAll}>
        <div class="flex shrink-0 items-center justify-end border-b border-border/40 px-2 py-1">
          <button
            type="button"
            class="text-[10px] text-muted-foreground hover:text-destructive"
            onClick={() => {
              props.onClearAll?.()
            }}
          >
            Clear all
          </button>
        </div>
      </Show>

      <Show
        when={hasStaged()}
        fallback={
          <div class="h-full px-2 py-3 text-center text-[10px] text-muted-foreground">
            No pending trades. Edit weights or adjust leverage to stage trades.
          </div>
        }
      >
        <div class="h-full min-h-0 overflow-auto scrollbar-hide">
          <For each={stagedTrades()}>
            {stagedTrade => {
              const baseSymbol = stagedTrade.underlying.split("/")[0] || "???"
              const orderError = stagedTrade.orderError

              const prevWeight = stagedTrade.previousWeight ?? 0
              const nextWeight = stagedTrade.newWeight ?? prevWeight
              const weightDelta = nextWeight - prevWeight

              const arrow = weightDelta > 0 ? "↑" : weightDelta < 0 ? "↓" : "→"
              const deltaClass =
                weightDelta > 0
                  ? "text-emerald-500"
                  : weightDelta < 0
                    ? "text-rose-500"
                    : "text-muted-foreground"

              return (
                <div class="border-b border-border/30">
                  <div class={cn(STAGED_ROW_GRID_TEMPLATE)}>
                    <span
                      class={cn(
                        "text-[10px] font-medium px-1 py-0.5 rounded w-[5ch] text-center",
                        stagedTrade.side === "buy"
                          ? "bg-green-500/20 text-green-500"
                          : "bg-red-500/20 text-red-500",
                      )}
                    >
                      {stagedTrade.side === "buy" ? "BUY" : "SELL"}
                    </span>
                    <span
                      class={cn(
                        "px-1 truncate font-medium text-[11px] text-left",
                        orderError && "text-destructive",
                      )}
                    >
                      {baseSymbol}
                    </span>
                    <div
                      class={cn(
                        "font-mono mr-2 justify-self-center grid grid-cols-[max-content_2ch_max-content] items-baseline gap-x-1",
                        deltaClass,
                      )}
                    >
                      <span class="w-[6ch] text-right">
                        {formatUnsignedPct(prevWeight)}
                      </span>
                      <span class="w-[2ch] text-center">{arrow}</span>
                      <span class="w-[6ch] text-right">
                        {formatUnsignedPct(nextWeight)}
                      </span>
                    </div>
                    <span class="font-mono text-muted-foreground justify-self-end w-full text-right">
                      {formatUsdPrecise(stagedTrade.notional)}
                    </span>
                  </div>
                  <Show when={orderError}>
                    <p
                      role="alert"
                      class="px-2 pb-1.5 text-[10px] leading-snug text-destructive"
                    >
                      {orderError}
                    </p>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>

      {/* Impact preview + primary rebalance / connect / unlock PIN */}
      <div class="px-2 py-1.5 border-t border-border/30 bg-muted/20 space-y-2">
        <div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
            <div class="flex justify-between flex-col">
              <span class="text-muted-foreground">Notional</span>
              <span class="font-mono">
                <Show
                  when={shouldShowNotionalArrow()}
                  fallback={formatUsdPrecise(targetTotalNotional())}
                >
                  {formatUsdPrecise(currentTotalNotional())}{" "}
                  <span class="text-muted-foreground">→</span>{" "}
                  <span
                    class={
                      targetTotalNotional() >= currentTotalNotional()
                        ? "text-green-500"
                        : "text-red-500"
                    }
                  >
                    {formatUsdPrecise(targetTotalNotional())}
                  </span>
                </Show>
              </span>
            </div>
            <div class="flex justify-between flex-col">
              <span class="text-muted-foreground">Leverage</span>
              <span class="font-mono">
                <Show
                  when={shouldShowLeverageArrow()}
                  fallback={`${targetLeverage().toFixed(2)}x`}
                >
                  {currentLeverage().toFixed(2)}x{" "}
                  <span class="text-muted-foreground">→</span>{" "}
                  <span class="text-yellow-500">
                    {targetLeverage().toFixed(2)}x
                  </span>
                </Show>
              </span>
            </div>
          </div>
        </div>
        <Show
          when={showUnlockPinField()}
          fallback={
            <Button
              size="sm"
              class="w-full h-8 text-[11px] gap-1"
              onPointerEnter={() => {
                if (connectionState() === "agentMissing") {
                  prefetchEvmAppKit()
                }
              }}
              onClick={() => {
                if (isPrimaryDisabled() || !props.onPrimaryAction) {
                  return
                }
                props.onPrimaryAction()
              }}
              disabled={isPrimaryDisabled()}
              aria-disabled={isPrimaryDisabled()}
            >
              <Send class="h-3 w-3" />
              {primaryLabel()}
            </Button>
          }
        >
          <div class="space-y-1">
            <Input
              id="stagedChangesUnlockPin"
              ref={element => {
                unlockPinInput = element
              }}
              type="password"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder={UNLOCK_PIN_PLACEHOLDER}
              maxlength={WALLET_PIN_LENGTH}
              value={unlockPin()}
              disabled={isRebalancing()}
              aria-label={UNLOCK_PIN_PLACEHOLDER}
              aria-invalid={unlockError() !== null}
              aria-describedby={
                unlockError() !== null ? UNLOCK_PIN_ERROR_ID : undefined
              }
              class="h-8 font-mono text-[11px] tracking-[0.25em] placeholder:tracking-normal placeholder:font-sans"
              onAnimationEnd={event => {
                event.currentTarget.classList.remove(PIN_SHAKE_CLASS)
              }}
              onInput={event => {
                const nextPin = normalizeWalletPinInput(
                  event.currentTarget.value,
                )
                setUnlockPin(nextPin)
                setUnlockError(null)
                if (nextPin.length === WALLET_PIN_LENGTH) {
                  void submitUnlockPin(nextPin)
                }
              }}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void submitUnlockPin()
                }
              }}
            />
            <Show when={unlockError()}>
              <p
                id={UNLOCK_PIN_ERROR_ID}
                role="alert"
                class="text-[10px] leading-snug text-destructive"
              >
                {unlockError()}
              </p>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
