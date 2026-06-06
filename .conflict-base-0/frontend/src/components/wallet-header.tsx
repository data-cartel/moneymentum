import { createSignal, createEffect, Show } from "solid-js"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useWalletSettings, useSwitchNetwork } from "@/hooks/useTrading"
import { useNetwork } from "@/hooks/useNetwork"
import { useWallet } from "@/hooks/useWallet"
import { toast } from "solid-sonner"

const formatPublicKey = (key: string): string => {
  if (!key || key.length < 10) return key
  if (key.startsWith("0x")) {
    return `${key.slice(0, 6)}...${key.slice(-4)}`
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

interface WalletHeaderProps {
  autoOpen?: boolean
  handleDisconnect?: () => void
  handleNetworkSwitch?: () => void
}

export const WalletHeader = (props: WalletHeaderProps) => {
  const { data: walletSettings, isConnected } = useWalletSettings()
  const switchNetworkMutation = useSwitchNetwork()
  const { isNetworkSwitching, setIsNetworkSwitching } = useNetwork()
  const { connect, disconnect } = useWallet()

  const [dialogOpen, setDialogOpen] = createSignal(false)
  const [accountAddress, setAccountAddress] = createSignal("")
  const [apiWalletAddress, setApiWalletAddress] = createSignal("")
  const [privateKey, setPrivateKey] = createSignal("")
  const [vaultAddress, setVaultAddress] = createSignal("")
  const [hasAutoOpened, setHasAutoOpened] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)

  // Auto-open the dialog once on mount when autoOpen is true and no wallet is
  // connected. The hasAutoOpened flag prevents re-triggering on later
  // disconnects.
  createEffect(() => {
    if (props.autoOpen && !isConnected() && !hasAutoOpened()) {
      setDialogOpen(true)
      setHasAutoOpened(true)
    }
  })

  const handleTestnetToggle = async (checked: boolean) => {
    if (!isConnected()) {
      toast.error("Please connect wallet first")
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

  const handleConnect = () => {
    if (
      !accountAddress().trim() ||
      !apiWalletAddress().trim() ||
      !privateKey().trim()
    ) {
      toast.error(
        "Please enter account address, API wallet address, and private key",
      )
      return
    }

    const credentials: {
      accountAddress: string
      apiWalletAddress: string
      privateKey: string
      vaultAddress?: string
    } = {
      accountAddress: accountAddress().trim(),
      apiWalletAddress: apiWalletAddress().trim(),
      privateKey: privateKey().trim(),
    }

    if (vaultAddress().trim()) {
      credentials.vaultAddress = vaultAddress().trim()
    }

    connect(credentials)
    setDialogOpen(false)
    setAccountAddress("")
    setApiWalletAddress("")
    setPrivateKey("")
    setVaultAddress("")
    toast.success("Wallet connected")
  }

  const onDisconnectClick = () => {
    props.handleDisconnect?.()
    disconnect()
    setDialogOpen(false)
    setMenuOpen(false)
    toast.success("Wallet disconnected")
  }

  const currentAccountAddress = () => walletSettings()?.accountAddress ?? ""
  const currentIsTestnet = () => walletSettings()?.isTestnet ?? true
  const isDisabled = () =>
    !isConnected() || switchNetworkMutation.isPending || isNetworkSwitching()

  const handleCopyAddress = async () => {
    if (!currentAccountAddress()) {
      toast.error("No wallet address to copy")
      return
    }

    try {
      await navigator.clipboard.writeText(currentAccountAddress())
      toast.success("Address copied")
    } catch (error) {
      console.error("Failed to copy address to clipboard:", error)
      toast.error("Failed to copy address. Check clipboard permissions.")
    }
  }

  return (
    <div class="flex items-center gap-4">
      <Show when={isNetworkSwitching()}>
        <span class="text-[11px] text-muted-foreground">Switching...</span>
      </Show>

      <Show
        when={isConnected()}
        fallback={
          <Dialog open={dialogOpen()} onOpenChange={setDialogOpen}>
            <DialogTrigger
              as="button"
              class="cursor-pointer rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground"
            >
              {currentAccountAddress()
                ? formatPublicKey(currentAccountAddress())
                : "No wallet configured"}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Connect Wallet</DialogTitle>
                <DialogDescription>
                  Enter your Hyperliquid API wallet credentials to connect.
                </DialogDescription>
              </DialogHeader>

              <div class="space-y-4 text-[12px]">
                <div class="space-y-2">
                  <label for="accountAddress" class="font-medium">
                    Hyperliquid main wallet address
                  </label>
                  <Input
                    id="accountAddress"
                    placeholder="0x..."
                    value={accountAddress()}
                    onInput={event => {
                      setAccountAddress(event.currentTarget.value)
                    }}
                  />
                </div>
                <div class="space-y-2">
                  <label for="apiWalletAddress" class="font-medium">
                    Hyperliquid public API wallet address
                  </label>
                  <Input
                    id="apiWalletAddress"
                    placeholder="0x..."
                    value={apiWalletAddress()}
                    onInput={event => {
                      setApiWalletAddress(event.currentTarget.value)
                    }}
                  />
                </div>
                <div class="space-y-2">
                  <label for="privateKey" class="font-medium">
                    Hyperliquid private API wallet key
                  </label>
                  <Input
                    id="privateKey"
                    type="password"
                    placeholder="0x..."
                    value={privateKey()}
                    onInput={event => {
                      setPrivateKey(event.currentTarget.value)
                    }}
                  />
                </div>
                <div class="space-y-2">
                  <label for="vaultAddress" class="font-medium">
                    Vault Address (Optional)
                  </label>
                  <Input
                    id="vaultAddress"
                    placeholder="0x... (leave empty for personal trading)"
                    value={vaultAddress()}
                    onInput={event => {
                      setVaultAddress(event.currentTarget.value)
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleConnect}>Connect</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      >
        <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            as="button"
            class="cursor-pointer rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground"
          >
            {currentAccountAddress()
              ? formatPublicKey(currentAccountAddress())
              : "No wallet configured"}
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-[260px] p-3 text-[11px] leading-snug">
            <div class="flex flex-col gap-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <p class="text-[10px] text-muted-foreground">Account</p>
                  <p class="break-all font-mono text-[11px]">
                    {currentAccountAddress()}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="h-6 px-2 text-[10px]"
                  onClick={handleCopyAddress}
                >
                  Copy
                </Button>
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

              <Button
                type="button"
                variant="outline"
                onClick={onDisconnectClick}
              >
                Disconnect
              </Button>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </Show>
    </div>
  )
}
