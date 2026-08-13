import { Show, createSignal, onCleanup } from "solid-js"
import * as Effect from "effect/Effect"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWalletSettings, useSwitchNetwork } from "@/hooks/useTrading"
import { useNetwork } from "@/hooks/useNetwork"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import {
  WalletOperationContextChanged,
  copyWalletAddressToClipboard,
} from "@/services/wallet"
import { toast } from "solid-sonner"

const formatPublicKey = (key: string): string => {
  if (!key || key.length < 10) return key
  if (key.startsWith("0x")) {
    return `${key.slice(0, 6)}...${key.slice(-4)}`
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

const walletStatusClass =
  "rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground"

const REVOKE_AGENT_TOOLTIP =
  "Revokes Moneymentum's trading agent on Hyperliquid. Your main wallet signs once via Reown. After revoke, this app cannot place trades until you authorize a new agent."

interface WalletHeaderProps {
  handleDisconnect?: () => void
  handleNetworkSwitch?: () => void
}

export const WalletHeader = (props: WalletHeaderProps) => {
  const { data: walletSettings } = useWalletSettings()
  const switchNetworkMutation = useSwitchNetwork()
  const { isNetworkSwitching, setIsNetworkSwitching } = useNetwork()
  const {
    disconnect,
    revokeAgent,
    isLocked,
    canTrade,
    isConnected,
    hasStoredSession,
    mainAddress,
  } = useWallet()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [isDisconnecting, setIsDisconnecting] = createSignal(false)
  const [isRevokingAgent, setIsRevokingAgent] = createSignal(false)
  const [showCopied, setShowCopied] = createSignal(false)
  let networkSwitchRevision = 0
  let copiedTimeoutId: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (copiedTimeoutId !== undefined) {
      clearTimeout(copiedTimeoutId)
    }
  })

  const handleTestnetToggle = (checked: boolean) => {
    if (!isConnected()) {
      toast.error("Please connect wallet first")
      return
    }

    if (
      switchNetworkMutation.isPending ||
      isNetworkSwitching() ||
      isDisconnecting() ||
      isRevokingAgent()
    ) {
      return
    }

    const accountAddress = mainAddress()?.toLowerCase() ?? null
    const operationRevision = ++networkSwitchRevision
    setIsNetworkSwitching(true)
    void Effect.runPromise(
      Effect.tryPromise({
        try: () =>
          switchNetworkMutation.mutateAsync(checked ? "testnet" : "mainnet"),
        catch: cause => new WalletOperationContextChanged({ cause }),
      }).pipe(
        Effect.tap(() =>
          // The completion intentionally validates current wallet signals.
          // eslint-disable-next-line solid/reactivity
          Effect.sync(() => {
            const currentAddress = mainAddress()?.toLowerCase() ?? null
            if (
              operationRevision === networkSwitchRevision &&
              currentAddress === accountAddress &&
              isConnected()
            ) {
              props.handleNetworkSwitch?.()
            }
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsNetworkSwitching(false)
          }),
        ),
      ),
    )
  }

  const onDisconnectClick = () => {
    if (
      isDisconnecting() ||
      isRevokingAgent() ||
      switchNetworkMutation.isPending ||
      isNetworkSwitching()
    ) {
      return
    }

    setIsDisconnecting(true)
    void Effect.runPromise(
      disconnect().pipe(
        Effect.tap(() =>
          // This post-disconnect callback runs from the click handler's Effect.
          // eslint-disable-next-line solid/reactivity
          Effect.sync(() => {
            props.handleDisconnect?.()
            setMenuOpen(false)
            toast.success("Wallet disconnected")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsDisconnecting(false)
          }),
        ),
      ),
    )
  }

  const onRevokeAgentClick = () => {
    if (
      isRevokingAgent() ||
      isDisconnecting() ||
      switchNetworkMutation.isPending ||
      isNetworkSwitching()
    ) {
      return
    }

    setIsRevokingAgent(true)
    void Effect.runPromise(
      revokeAgent().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            toast.success("Hyperliquid agent revoked")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsRevokingAgent(false)
          }),
        ),
      ),
    )
  }

  const currentAccountAddress = () =>
    walletSettings()?.accountAddress ?? mainAddress() ?? ""
  const currentIsTestnet = () => walletSettings()?.isTestnet ?? true
  const isDisabled = () =>
    !isConnected() ||
    switchNetworkMutation.isPending ||
    isNetworkSwitching() ||
    isDisconnecting() ||
    isRevokingAgent()
  const canRevokeAgent = () =>
    isConnected() &&
    (hasStoredSession() || canTrade()) &&
    !isRevokingAgent() &&
    !isDisconnecting() &&
    !switchNetworkMutation.isPending &&
    !isNetworkSwitching()

  const onAddressClick = () => {
    void Effect.runPromise(
      copyWalletAddressToClipboard(currentAccountAddress()).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setShowCopied(true)
            if (copiedTimeoutId !== undefined) {
              clearTimeout(copiedTimeoutId)
            }
            copiedTimeoutId = setTimeout(() => {
              setShowCopied(false)
            }, 1500)
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

  return (
    <div class="flex items-center gap-4">
      <Show when={isNetworkSwitching()}>
        <span class="text-[11px] text-muted-foreground">Switching...</span>
      </Show>

      <Show
        when={isConnected()}
        fallback={<span class={walletStatusClass}>No wallet configured</span>}
      >
        <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            as="button"
            class={`${walletStatusClass} cursor-pointer transition-colors hover:border-foreground/50 hover:text-foreground`}
          >
            {currentAccountAddress()
              ? formatPublicKey(currentAccountAddress())
              : "No wallet configured"}
            <Show when={isLocked()}>
              <span class="ml-1 text-muted-foreground">(locked)</span>
            </Show>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-[260px] p-3 text-[11px] leading-snug">
            <div class="flex flex-col gap-3">
              <div class="min-w-0">
                <p class="text-[10px] text-muted-foreground">Account</p>
                <button
                  type="button"
                  class="relative -mx-1 w-[calc(100%+0.5rem)] cursor-pointer break-all rounded px-1 py-0.5 text-left font-mono text-[11px] transition-colors hover:bg-muted"
                  aria-label="Copy address"
                  onClick={onAddressClick}
                >
                  {currentAccountAddress()}
                  <Show when={showCopied()}>
                    <span
                      class="absolute inset-0 flex items-center justify-center rounded bg-emerald-600 text-[10px] font-medium text-white"
                      aria-live="polite"
                    >
                      Copied
                    </span>
                  </Show>
                </button>
                <Show when={isLocked() && !canTrade()}>
                  <p class="mt-1 text-[10px] text-muted-foreground">
                    Agent locked — enter PIN to trade
                  </p>
                </Show>
              </div>

              <div class="h-px bg-border" />

              <div class="flex items-center justify-between gap-2">
                <span class="text-muted-foreground">Testnet</span>
                <Switch
                  checked={currentIsTestnet()}
                  onChange={handleTestnetToggle}
                  disabled={isDisabled()}
                />
              </div>

              <div class="h-px bg-border" />

              <TooltipProvider>
                <Tooltip openDelay={200}>
                  <TooltipTrigger
                    as="div"
                    class="w-full"
                    aria-label={REVOKE_AGENT_TOOLTIP}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      class="w-full"
                      disabled={!canRevokeAgent()}
                      onClick={onRevokeAgentClick}
                    >
                      {isRevokingAgent() ? "Revoking..." : "Revoke Agent"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent class="max-w-[240px] text-xs leading-snug">
                    {REVOKE_AGENT_TOOLTIP}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <Button
                type="button"
                variant="outline"
                disabled={
                  isDisconnecting() ||
                  isRevokingAgent() ||
                  switchNetworkMutation.isPending ||
                  isNetworkSwitching()
                }
                onClick={onDisconnectClick}
              >
                {isDisconnecting() ? "Disconnecting..." : "Disconnect"}
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </Show>
    </div>
  )
}
