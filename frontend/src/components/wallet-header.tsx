import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js"
import * as Effect from "effect/Effect"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  useWalletSettings,
  useSwitchNetwork,
  useDeriveAccountSnapshot,
} from "@/hooks/useTrading"
import { useNetwork } from "@/hooks/useNetwork"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"
import { prefetchEvmAppKit } from "@/reown/evmAppKit"
import { copyWalletAddressToClipboard } from "@/services/wallet"
import { toast } from "solid-sonner"
import { tryUsePortfolioShell } from "@/pages/Portfolio/portfolioShellContext"

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

interface SubaccountOption {
  id: number
  label: string
}

const formatUsd = (value: number): string =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

interface WalletHeaderProps {
  handleNetworkSwitch?: () => void
}

export const WalletHeader = (props: WalletHeaderProps) => {
  const { data: walletSettings, isConnected } = useWalletSettings()
  const switchNetworkMutation = useSwitchNetwork()
  const { isNetworkSwitching, setIsNetworkSwitching } = useNetwork()
  const {
    disconnect,
    disconnectDerive,
    revokeAgent,
    isLocked,
    isDeriveLocked,
    canTrade,
    deriveCredentials,
    setDeriveSubaccountId,
  } = useWallet()
  const accountSnapshot = useDeriveAccountSnapshot()
  const shell = tryUsePortfolioShell()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [isRevokingAgent, setIsRevokingAgent] = createSignal(false)
  const [disconnectingVenue, setDisconnectingVenue] = createSignal<
    "hyperliquid" | "derive" | null
  >(null)
  const [copiedAddress, setCopiedAddress] = createSignal<string | null>(null)
  let copiedTimeoutId: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (copiedTimeoutId !== undefined) {
      clearTimeout(copiedTimeoutId)
    }
  })

  const venues = () => walletSettings().venues
  const hyperliquidVenue = () =>
    venues().find(venue => venue.id === "hyperliquid")
  const deriveVenue = () => venues().find(venue => venue.id === "derive")

  const subaccountOptions = createMemo((): SubaccountOption[] => {
    const snapshot = accountSnapshot.data
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
        label: `#${String(subaccount.subaccountId)} ($${balanceLabel})`,
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

  const triggerLabel = () => {
    const connected = venues().filter(
      (venue): venue is typeof venue & { address: string } =>
        venue.connected && typeof venue.address === "string",
    )
    if (connected.length === 0) {
      return "No wallet"
    }
    if (connected.length === 1) {
      return formatPublicKey(connected[0].address)
    }
    return `${String(connected.length)} venues`
  }

  const handleTestnetToggle = async (checked: boolean) => {
    if (!isConnected()) {
      toast.error("Please connect a venue first")
      return
    }

    if (switchNetworkMutation.isPending || isNetworkSwitching()) {
      return
    }

    setIsNetworkSwitching(true)

    try {
      await switchNetworkMutation.mutateAsync(checked ? "testnet" : "mainnet")
      props.handleNetworkSwitch?.()
    } catch (error) {
      console.error("Failed to toggle testnet/mainnet:", error)
      toast.error("Failed to toggle network. Please try again.")
    } finally {
      setIsNetworkSwitching(false)
    }
  }

  const onHyperliquidDisconnect = () => {
    if (disconnectingVenue() !== null || isRevokingAgent()) {
      return
    }

    setDisconnectingVenue("hyperliquid")
    void Effect.runPromise(
      disconnect().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setMenuOpen(false)
            toast.success("Hyperliquid disconnected")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setDisconnectingVenue(null)
          }),
        ),
      ),
    )
  }

  const onDeriveDisconnect = () => {
    if (disconnectingVenue() !== null || isRevokingAgent()) {
      return
    }

    setDisconnectingVenue("derive")
    void Effect.runPromise(
      disconnectDerive().pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setMenuOpen(false)
            toast.success("Derive disconnected")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setDisconnectingVenue(null)
          }),
        ),
      ),
    )
  }

  const onRevokeAgentClick = () => {
    if (
      isRevokingAgent() ||
      disconnectingVenue() !== null ||
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

  const currentIsTestnet = () => walletSettings().isTestnet
  const isDisabled = () =>
    !isConnected() || switchNetworkMutation.isPending || isNetworkSwitching()
  const canRevokeAgent = () =>
    (hyperliquidVenue()?.canRevoke ?? false) &&
    !isRevokingAgent() &&
    disconnectingVenue() === null &&
    !switchNetworkMutation.isPending &&
    !isNetworkSwitching()

  const onAddressClick = (address: string) => {
    void Effect.runPromise(
      copyWalletAddressToClipboard(address).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setCopiedAddress(address)
            if (copiedTimeoutId !== undefined) {
              clearTimeout(copiedTimeoutId)
            }
            copiedTimeoutId = setTimeout(() => {
              setCopiedAddress(null)
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

  const connectHyperliquid = () => {
    setMenuOpen(false)
    shell?.focusVenue({ venue: "hyperliquid", openConnect: true })
  }

  const connectDerive = () => {
    setMenuOpen(false)
    shell?.focusVenue({ venue: "derive", focusWalletField: true })
  }

  return (
    <div class="flex items-center gap-4">
      <Show when={isNetworkSwitching()}>
        <span class="text-[11px] text-muted-foreground">Switching...</span>
      </Show>

      <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          as="button"
          class={`${walletStatusClass} cursor-pointer transition-colors hover:border-foreground/50 hover:text-foreground`}
          onPointerEnter={() => {
            prefetchEvmAppKit()
          }}
        >
          {triggerLabel()}
          <Show when={isLocked() || isDeriveLocked()}>
            <span class="ml-1 text-muted-foreground">(locked)</span>
          </Show>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-[360px] p-3 text-[11px] leading-snug">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-muted-foreground">Testnet</span>
              <Switch
                checked={currentIsTestnet()}
                onChange={handleTestnetToggle}
                disabled={isDisabled()}
              />
            </div>

            <div class="h-px bg-border" />

            <div class="min-w-0 space-y-2">
              <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Hyperliquid account
              </p>
              <Show
                when={
                  hyperliquidVenue()?.connected && hyperliquidVenue()?.address
                }
                fallback={
                  <Button
                    type="button"
                    variant="outline"
                    class="w-full"
                    onPointerEnter={() => {
                      prefetchEvmAppKit()
                    }}
                    onClick={connectHyperliquid}
                  >
                    Connect Hyperliquid
                  </Button>
                }
              >
                <button
                  type="button"
                  class="relative -mx-1 w-[calc(100%+0.5rem)] cursor-pointer break-all rounded px-1 py-0.5 text-left font-mono text-[11px] transition-colors hover:bg-muted"
                  aria-label="Copy Hyperliquid address"
                  onClick={() => {
                    const address = hyperliquidVenue()?.address
                    if (address) {
                      onAddressClick(address)
                    }
                  }}
                >
                  {hyperliquidVenue()?.address}
                  <Show when={copiedAddress() === hyperliquidVenue()?.address}>
                    <span
                      class="absolute inset-0 flex items-center justify-center rounded bg-emerald-600 text-[10px] font-medium text-white"
                      aria-live="polite"
                    >
                      Copied
                    </span>
                  </Show>
                </button>
                <Show when={isLocked() && !canTrade()}>
                  <p class="text-[10px] text-muted-foreground">
                    Agent locked — enter PIN to trade
                  </p>
                </Show>
                <div class="flex gap-2">
                  <TooltipProvider>
                    <Tooltip openDelay={200}>
                      <TooltipTrigger
                        as="div"
                        class="min-w-0 flex-1"
                        aria-label={REVOKE_AGENT_TOOLTIP}
                      >
                        <Button
                          type="button"
                          variant="outline"
                          class="w-full transition-opacity"
                          classList={{ "opacity-50": isRevokingAgent() }}
                          disabled={!canRevokeAgent()}
                          onPointerEnter={() => {
                            prefetchEvmAppKit()
                          }}
                          onClick={onRevokeAgentClick}
                        >
                          {isRevokingAgent()
                            ? "Loading wallet..."
                            : "Revoke Agent"}
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
                    class="min-w-0 flex-1 transition-opacity"
                    classList={{
                      "opacity-50": disconnectingVenue() === "hyperliquid",
                    }}
                    disabled={
                      disconnectingVenue() !== null || isRevokingAgent()
                    }
                    onPointerEnter={() => {
                      prefetchEvmAppKit()
                    }}
                    onClick={onHyperliquidDisconnect}
                  >
                    {disconnectingVenue() === "hyperliquid"
                      ? "Disconnecting..."
                      : "Disconnect"}
                  </Button>
                </div>
              </Show>
            </div>

            <div class="h-px bg-border" />

            <div class="min-w-0 space-y-2">
              <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Derive account
              </p>
              <Show
                when={deriveVenue()?.connected && deriveVenue()?.address}
                fallback={
                  <Button
                    type="button"
                    variant="outline"
                    class="w-full"
                    onClick={connectDerive}
                  >
                    Connect Derive
                  </Button>
                }
              >
                <button
                  type="button"
                  class="relative -mx-1 w-[calc(100%+0.5rem)] cursor-pointer break-all rounded px-1 py-0.5 text-left font-mono text-[11px] transition-colors hover:bg-muted"
                  aria-label="Copy Derive address"
                  onClick={() => {
                    const address = deriveVenue()?.address
                    if (address) {
                      onAddressClick(address)
                    }
                  }}
                >
                  {deriveVenue()?.address}
                  <Show when={copiedAddress() === deriveVenue()?.address}>
                    <span
                      class="absolute inset-0 flex items-center justify-center rounded bg-emerald-600 text-[10px] font-medium text-white"
                      aria-live="polite"
                    >
                      Copied
                    </span>
                  </Show>
                </button>
                <Show when={isDeriveLocked()}>
                  <p class="text-[10px] text-muted-foreground">
                    Session locked — enter PIN on Derive tab
                  </p>
                </Show>
                <Show when={!isDeriveLocked()}>
                  <div class="space-y-1">
                    <p class="text-[10px] text-muted-foreground">Subaccount</p>
                    <Show
                      when={subaccountOptions().length > 0}
                      fallback={
                        <p class="text-[10px] text-muted-foreground">
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
                        <SelectTrigger class="h-8 w-full font-mono text-[11px]">
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
                </Show>
                <Button
                  type="button"
                  variant="outline"
                  class="w-full transition-opacity"
                  classList={{
                    "opacity-50": disconnectingVenue() === "derive",
                  }}
                  disabled={disconnectingVenue() !== null || isRevokingAgent()}
                  onClick={onDeriveDisconnect}
                >
                  {disconnectingVenue() === "derive"
                    ? "Disconnecting..."
                    : "Disconnect"}
                </Button>
              </Show>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
