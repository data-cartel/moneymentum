import { createSignal, For, Show, type JSX } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import * as Effect from "effect/Effect"
import { toast } from "solid-sonner"

import { ModeToggle } from "@/components/ui/mode-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Toaster } from "@/components/ui/sonner"
import { getErrorMessage } from "@/lib/error-message"
import type { NetworkMode } from "@/contexts/wallet-context"
import {
  clearStoredDeriveSession,
  DeriveSessionMissing,
  fetchDeriveAccountSnapshot,
  fetchDeriveBalance,
  readStoredDeriveSession,
  saveDeriveCredentials,
  type DeriveAccountSnapshot,
  type DeriveBalanceSummary,
  type DeriveSessionCredentials,
  type DeriveSubaccountSnapshot,
} from "@/services/deriveAccount"
import {
  fetchDeriveMarkets,
  type DeriveInstrument,
} from "@/services/derive-markets"
import {
  fetchDeriveFundingRates,
  fetchDeriveOpenOrders,
  fetchDeriveTickers,
  placeAndMonitorDeriveOrders,
  type DeriveBatchOrderRequest,
  type DeriveFundingRateQuote,
  type DeriveTickerQuote,
} from "@/services/derive-client"
import type { OrderResult } from "@/services/hyperliquid-client"

type TestTab = "account" | "markets" | "trading"

const TestPageContent = (): JSX.Element => {
  const stored = readStoredDeriveSession()

  const [activeTab, setActiveTab] = createSignal<TestTab>("account")
  const [credentials, setCredentials] =
    createSignal<DeriveSessionCredentials | null>(stored)
  const [networkMode, setNetworkMode] = createSignal<NetworkMode>(
    stored?.networkMode ?? "testnet",
  )
  const [deriveWalletInput, setDeriveWalletInput] = createSignal(
    stored?.deriveWallet ?? "",
  )
  const [sessionKeyInput, setSessionKeyInput] = createSignal(
    stored?.sessionPrivateKey ?? "",
  )
  const [subaccountIdInput, setSubaccountIdInput] = createSignal(
    stored?.subaccountId !== null && stored?.subaccountId !== undefined
      ? String(stored.subaccountId)
      : "",
  )
  const [isSaving, setIsSaving] = createSignal(false)
  const [instrumentFilter, setInstrumentFilter] = createSignal("")
  const [tickerSymbolsInput, setTickerSymbolsInput] = createSignal(
    "ETH-PERP,ETH-20260925-2000-C",
  )
  const [fundingSymbolsInput, setFundingSymbolsInput] =
    createSignal("ETH-PERP,BTC-PERP")
  const [orderSymbolInput, setOrderSymbolInput] = createSignal(
    "ETH-20260925-2000-C",
  )
  const [orderSideInput, setOrderSideInput] = createSignal<"buy" | "sell">(
    "buy",
  )
  const [orderAmountInput, setOrderAmountInput] = createSignal("1")
  const [orderPriceInput, setOrderPriceInput] = createSignal("77")
  const [tickersResult, setTickersResult] = createSignal<Record<
    string,
    DeriveTickerQuote
  > | null>(null)
  const [fundingResult, setFundingResult] = createSignal<Record<
    string,
    DeriveFundingRateQuote
  > | null>(null)
  const [orderResults, setOrderResults] = createSignal<OrderResult[] | null>(
    null,
  )
  const [isTradingBusy, setIsTradingBusy] = createSignal(false)

  const sessionMatches = () => {
    const current = credentials()
    return current !== null && current.networkMode === networkMode()
  }

  const accountQuery = useQuery(() => {
    const current = credentials()
    const network = networkMode()

    return {
      queryKey: [
        "derive",
        "account-snapshot",
        current?.sessionAddress ?? null,
        current?.deriveWallet ?? null,
        current?.subaccountId ?? null,
        network,
      ],
      enabled: sessionMatches() && activeTab() === "account",
      queryFn: ({ signal }) => {
        if (current?.networkMode !== network) {
          return Effect.runPromise(Effect.fail(new DeriveSessionMissing()))
        }

        return Effect.runPromise(fetchDeriveAccountSnapshot(current, signal))
      },
      refetchInterval: 15_000,
    }
  })

  const balanceQuery = useQuery(() => {
    const current = credentials()
    const network = networkMode()

    return {
      queryKey: [
        "derive",
        "balance",
        current?.sessionAddress ?? null,
        current?.deriveWallet ?? null,
        current?.subaccountId ?? null,
        network,
      ],
      enabled: sessionMatches() && activeTab() === "account",
      queryFn: () => {
        if (current?.networkMode !== network) {
          return Effect.runPromise(Effect.fail(new DeriveSessionMissing()))
        }

        return Effect.runPromise(fetchDeriveBalance(current))
      },
      refetchInterval: 15_000,
    }
  })

  const marketsQuery = useQuery(() => {
    const network = networkMode()

    return {
      queryKey: ["derive", "markets", network],
      enabled: activeTab() === "markets",
      queryFn: ({ signal }) =>
        Effect.runPromise(fetchDeriveMarkets(network, signal)),
      staleTime: 60_000,
    }
  })

  const openOrdersQuery = useQuery(() => {
    const current = credentials()
    const network = networkMode()

    return {
      queryKey: [
        "derive",
        "open-orders",
        current?.sessionAddress ?? null,
        current?.subaccountId ?? null,
        network,
      ],
      enabled:
        activeTab() === "trading" &&
        sessionMatches() &&
        current?.subaccountId !== null &&
        current?.subaccountId !== undefined,
      queryFn: () => {
        if (current?.networkMode !== network) {
          return Effect.runPromise(Effect.fail(new DeriveSessionMissing()))
        }
        return Effect.runPromise(fetchDeriveOpenOrders(current))
      },
      refetchInterval: 10_000,
    }
  })

  const splitSymbols = (raw: string): string[] =>
    raw
      .split(",")
      .map(symbol => symbol.trim())
      .filter(symbol => symbol.length > 0)

  const loadTickers = () => {
    const current = credentials()
    if (current === null || isTradingBusy()) {
      return
    }
    setIsTradingBusy(true)
    void Effect.runPromise(
      fetchDeriveTickers(current, splitSymbols(tickerSymbolsInput())).pipe(
        Effect.tap(tickers =>
          Effect.sync(() => {
            setTickersResult(tickers)
            toast.success("Tickers loaded")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(Effect.sync(() => setIsTradingBusy(false))),
      ),
    )
  }

  const loadFunding = () => {
    const current = credentials()
    if (current === null || isTradingBusy()) {
      return
    }
    setIsTradingBusy(true)
    void Effect.runPromise(
      fetchDeriveFundingRates(
        current,
        splitSymbols(fundingSymbolsInput()),
      ).pipe(
        Effect.tap(rates =>
          Effect.sync(() => {
            setFundingResult(rates)
            toast.success("Funding loaded")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(Effect.sync(() => setIsTradingBusy(false))),
      ),
    )
  }

  const placeTestOrder = () => {
    const current = credentials()
    if (current === null || isTradingBusy()) {
      return
    }
    if (current.subaccountId === null) {
      toast.error("Set a subaccount id before placing orders")
      return
    }

    const amount = Number(orderAmountInput())
    const price = Number(orderPriceInput())
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Amount must be a positive number")
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Price must be a positive number")
      return
    }

    const request: DeriveBatchOrderRequest = {
      symbol: orderSymbolInput().trim(),
      side: orderSideInput(),
      amount,
      price,
      type: "limit",
    }

    setIsTradingBusy(true)
    void Effect.runPromise(
      placeAndMonitorDeriveOrders(current, [request]).pipe(
        Effect.tap(results =>
          Effect.sync(() => {
            setOrderResults(results)
            void openOrdersQuery.refetch()
            toast.success("Order batch finished monitoring")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(Effect.sync(() => setIsTradingBusy(false))),
      ),
    )
  }

  const isRefreshing = () => accountQuery.isFetching || balanceQuery.isFetching

  const refreshAll = () => {
    void accountQuery.refetch()
    void balanceQuery.refetch()
  }

  const filteredInstruments = (): DeriveInstrument[] => {
    const instruments = marketsQuery.data?.instruments ?? []
    const needle = instrumentFilter().trim().toLowerCase()
    if (needle.length === 0) {
      return instruments
    }
    return instruments.filter(instrument =>
      [
        instrument.instrumentName,
        instrument.instrumentType,
        instrument.baseCurrency,
        instrument.quoteCurrency,
        instrument.optionType ?? "",
        instrument.strike ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }

  const saveCredentials = () => {
    if (isSaving()) {
      return
    }

    setIsSaving(true)
    void Effect.runPromise(
      saveDeriveCredentials(
        deriveWalletInput(),
        sessionKeyInput(),
        networkMode(),
        subaccountIdInput(),
      ).pipe(
        Effect.tap(saved =>
          Effect.sync(() => {
            setCredentials(saved)
            toast.success("Credentials saved -- loading positions")
          }),
        ),
        Effect.catchAll(error =>
          Effect.sync(() => {
            toast.error(getErrorMessage(error))
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsSaving(false)
          }),
        ),
      ),
    )
  }

  const clearCredentials = () => {
    clearStoredDeriveSession()
    setCredentials(null)
    setSessionKeyInput("")
    toast.success("Derive credentials cleared")
  }

  const handleNetworkToggle = (checked: boolean) => {
    const nextMode: NetworkMode = checked ? "testnet" : "mainnet"
    setNetworkMode(nextMode)

    const current = credentials()
    if (current !== null && current.networkMode !== nextMode) {
      // Saved creds are for the other network -- stop auto-fetch until re-saved.
      setCredentials(null)
    }
  }

  return (
    <div class="min-h-screen bg-background text-foreground">
      <header class="flex items-center justify-between border-b border-border px-4 py-3">
        <div class="flex flex-col gap-0.5">
          <h1 class="text-sm font-semibold tracking-tight">Derive API test</h1>
          <p class="text-[11px] text-muted-foreground">
            Account credentials + live markets catalogue
          </p>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Testnet</span>
            <Switch
              checked={networkMode() === "testnet"}
              onChange={handleNetworkToggle}
            />
          </div>
          <ModeToggle />
        </div>
      </header>

      <div class="border-b border-border px-4">
        <nav class="mx-auto flex max-w-5xl gap-1 py-2">
          <Button
            size="sm"
            variant={activeTab() === "account" ? "default" : "ghost"}
            onClick={() => setActiveTab("account")}
          >
            Account
          </Button>
          <Button
            size="sm"
            variant={activeTab() === "markets" ? "default" : "ghost"}
            onClick={() => setActiveTab("markets")}
          >
            Markets
          </Button>
          <Button
            size="sm"
            variant={activeTab() === "trading" ? "default" : "ghost"}
            onClick={() => setActiveTab("trading")}
          >
            Trading
          </Button>
        </nav>
      </div>

      <main class="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
        <Show when={activeTab() === "account"}>
          <section class="flex flex-col gap-3 border border-border p-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Credentials
            </h2>
            <p class="text-[11px] text-muted-foreground">
              Create a session key on derive.xyz → Developers, then paste Derive
              Wallet and Session Key private key here. Session registration is
              not available via API for UX accounts.
            </p>

            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
              <dt class="text-muted-foreground">Network</dt>
              <dd>{networkMode()}</dd>
              <dt class="text-muted-foreground">API</dt>
              <dd>
                {networkMode() === "testnet"
                  ? "/derive-api-demo -> api-demo.lyra.finance"
                  : "/derive-api -> api.lyra.finance"}
              </dd>
            </dl>

            <div class="flex flex-col gap-2">
              <label class="text-[11px] text-muted-foreground">
                Derive Wallet (SCW address)
              </label>
              <Input
                class="font-mono text-[11px]"
                placeholder="0x..."
                spellcheck={false}
                value={deriveWalletInput()}
                onInput={event =>
                  setDeriveWalletInput(event.currentTarget.value)
                }
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-[11px] text-muted-foreground">
                Session Key private key
              </label>
              <Input
                type="password"
                autocomplete="off"
                spellcheck={false}
                class="font-mono text-[11px]"
                placeholder="0x..."
                value={sessionKeyInput()}
                onInput={event => setSessionKeyInput(event.currentTarget.value)}
              />
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-[11px] text-muted-foreground">
                Subaccount ID (optional)
              </label>
              <Input
                class="font-mono text-[11px]"
                placeholder="Leave empty to load all"
                inputMode="numeric"
                value={subaccountIdInput()}
                onInput={event =>
                  setSubaccountIdInput(event.currentTarget.value)
                }
              />
            </div>

            <div class="flex flex-wrap gap-2">
              <Button size="sm" disabled={isSaving()} onClick={saveCredentials}>
                {isSaving() ? "Saving..." : "Save and load positions"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={credentials() === null}
                onClick={clearCredentials}
              >
                Clear
              </Button>
            </div>
          </section>

          <section class="flex flex-col gap-2 border border-border p-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Session
            </h2>
            <Show
              when={sessionMatches() ? credentials() : null}
              fallback={
                <p class="text-[11px] text-muted-foreground">
                  No saved credentials for this network.
                </p>
              }
            >
              {saved => (
                <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
                  <dt class="text-muted-foreground">Derive wallet</dt>
                  <dd class="break-all">{saved().deriveWallet}</dd>
                  <dt class="text-muted-foreground">Session key address</dt>
                  <dd class="break-all">{saved().sessionAddress}</dd>
                  <dt class="text-muted-foreground">Subaccount filter</dt>
                  <dd>{saved().subaccountId ?? "all"}</dd>
                </dl>
              )}
            </Show>
          </section>

          <section class="flex flex-col gap-3 border border-border p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Balance (CCXT fetchBalance)
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={!sessionMatches() || isRefreshing()}
                onClick={refreshAll}
              >
                {isRefreshing() ? "Loading..." : "Refresh"}
              </Button>
            </div>

            <Show when={balanceQuery.error}>
              <p class="text-[11px] text-destructive">
                {getErrorMessage(balanceQuery.error)}
              </p>
            </Show>

            <Show
              when={balanceQuery.data}
              fallback={
                <p class="text-[11px] text-muted-foreground">
                  Save credentials to call CCXT derive.fetchBalance
                  (private/get_all_portfolios).
                </p>
              }
            >
              {summary => <BalanceSummaryView summary={summary()} />}
            </Show>
          </section>

          <section class="flex flex-col gap-3 border border-border p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Account + positions
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={!sessionMatches() || isRefreshing()}
                onClick={refreshAll}
              >
                {isRefreshing() ? "Loading..." : "Refresh"}
              </Button>
            </div>

            <Show when={accountQuery.error}>
              <p class="text-[11px] text-destructive">
                {getErrorMessage(accountQuery.error)}
              </p>
            </Show>

            <Show
              when={accountQuery.data}
              fallback={
                <p class="text-[11px] text-muted-foreground">
                  Save credentials to call private/get_subaccounts and
                  private/get_subaccount.
                </p>
              }
            >
              {snapshot => <AccountSnapshotView snapshot={snapshot()} />}
            </Show>
          </section>
        </Show>

        <Show when={activeTab() === "markets"}>
          <section class="flex flex-col gap-3 border border-border p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-col gap-0.5">
                <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Derive markets
                </h2>
                <p class="text-[11px] text-muted-foreground">
                  GET /api/derive/markets?network={networkMode()} — options +
                  perps, no max_leverage
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={marketsQuery.isFetching}
                onClick={() => void marketsQuery.refetch()}
              >
                {marketsQuery.isFetching ? "Loading..." : "Refresh"}
              </Button>
            </div>

            <Show when={marketsQuery.error}>
              <p class="text-[11px] text-destructive">
                {getErrorMessage(marketsQuery.error)}
              </p>
            </Show>

            <Show when={marketsQuery.data}>
              {markets => (
                <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
                  <dt class="text-muted-foreground">Count</dt>
                  <dd>{markets().tickers.length}</dd>
                  <dt class="text-muted-foreground">Refreshed</dt>
                  <dd>{markets().refreshedAt}</dd>
                </dl>
              )}
            </Show>

            <Input
              class="font-mono text-[11px]"
              placeholder="Filter by name, type, base, strike..."
              value={instrumentFilter()}
              onInput={event => setInstrumentFilter(event.currentTarget.value)}
            />

            <div class="max-h-[60vh] overflow-auto">
              <table class="w-full border-collapse text-left font-mono text-[11px]">
                <thead class="sticky top-0 bg-background">
                  <tr class="border-b border-border text-muted-foreground">
                    <th class="px-2 py-1 font-medium">Instrument</th>
                    <th class="px-2 py-1 font-medium">Type</th>
                    <th class="px-2 py-1 font-medium">Base</th>
                    <th class="px-2 py-1 font-medium">Quote</th>
                    <th class="px-2 py-1 font-medium">Opt</th>
                    <th class="px-2 py-1 font-medium">Strike</th>
                    <th class="px-2 py-1 font-medium">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={filteredInstruments().length > 0}
                    fallback={
                      <tr>
                        <td class="px-2 py-3 text-muted-foreground" colspan={7}>
                          {marketsQuery.isLoading
                            ? "Loading markets..."
                            : "No instruments"}
                        </td>
                      </tr>
                    }
                  >
                    <For each={filteredInstruments()}>
                      {instrument => (
                        <tr class="border-b border-border/60">
                          <td class="px-2 py-1">{instrument.instrumentName}</td>
                          <td class="px-2 py-1">{instrument.instrumentType}</td>
                          <td class="px-2 py-1">{instrument.baseCurrency}</td>
                          <td class="px-2 py-1">{instrument.quoteCurrency}</td>
                          <td class="px-2 py-1">
                            {instrument.optionType ?? "—"}
                          </td>
                          <td class="px-2 py-1">{instrument.strike ?? "—"}</td>
                          <td class="px-2 py-1">
                            {instrument.expiryUnix ?? "—"}
                          </td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </div>
          </section>
        </Show>

        <Show when={activeTab() === "trading"}>
          <section class="flex flex-col gap-3 border border-border p-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Prices (CCXT fetchTicker)
            </h2>
            <p class="text-[11px] text-muted-foreground">
              Comma-separated instrument names or CCXT symbols. Options are
              hydrated via public/get_instrument when missing from the first
              markets page.
            </p>
            <Input
              class="font-mono text-[11px]"
              value={tickerSymbolsInput()}
              onInput={event =>
                setTickerSymbolsInput(event.currentTarget.value)
              }
            />
            <Button
              size="sm"
              disabled={!sessionMatches() || isTradingBusy()}
              onClick={loadTickers}
            >
              {isTradingBusy() ? "Working..." : "Fetch tickers"}
            </Button>
            <Show when={tickersResult()}>
              {tickers => (
                <ul class="flex flex-col gap-1 font-mono text-[11px]">
                  <For each={Object.entries(tickers())}>
                    {entry => (
                      <li>
                        {entry[0]} → {entry[1].symbol} bid={entry[1].bid ?? "—"}{" "}
                        ask={entry[1].ask ?? "—"} mark={entry[1].mark ?? "—"}
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
          </section>

          <section class="flex flex-col gap-3 border border-border p-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Funding (CCXT fetchFundingRate)
            </h2>
            <p class="text-[11px] text-muted-foreground">
              Perps only — options are skipped.
            </p>
            <Input
              class="font-mono text-[11px]"
              value={fundingSymbolsInput()}
              onInput={event =>
                setFundingSymbolsInput(event.currentTarget.value)
              }
            />
            <Button
              size="sm"
              disabled={!sessionMatches() || isTradingBusy()}
              onClick={loadFunding}
            >
              {isTradingBusy() ? "Working..." : "Fetch funding"}
            </Button>
            <Show when={fundingResult()}>
              {rates => (
                <ul class="flex flex-col gap-1 font-mono text-[11px]">
                  <For each={Object.entries(rates())}>
                    {entry => (
                      <li>
                        {entry[0]} → {entry[1].symbol} rate=
                        {entry[1].fundingRate}
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
          </section>

          <section class="flex flex-col gap-3 border border-border p-4">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Batch order + fill monitor
            </h2>
            <p class="text-[11px] text-muted-foreground">
              Sequential createOrder (no CCXT createOrders) + watchOrders, with
              fetchOrders fallback on timeout. Requires subaccount id.
            </p>
            <div class="grid gap-2 sm:grid-cols-2">
              <Input
                class="font-mono text-[11px]"
                placeholder="Instrument"
                value={orderSymbolInput()}
                onInput={event =>
                  setOrderSymbolInput(event.currentTarget.value)
                }
              />
              <Input
                class="font-mono text-[11px]"
                placeholder="Side buy|sell"
                value={orderSideInput()}
                onInput={event => {
                  const value = event.currentTarget.value.trim().toLowerCase()
                  if (value === "buy" || value === "sell") {
                    setOrderSideInput(value)
                  }
                }}
              />
              <Input
                class="font-mono text-[11px]"
                placeholder="Amount"
                value={orderAmountInput()}
                onInput={event =>
                  setOrderAmountInput(event.currentTarget.value)
                }
              />
              <Input
                class="font-mono text-[11px]"
                placeholder="Limit price"
                value={orderPriceInput()}
                onInput={event => setOrderPriceInput(event.currentTarget.value)}
              />
            </div>
            <Button
              size="sm"
              disabled={!sessionMatches() || isTradingBusy()}
              onClick={placeTestOrder}
            >
              {isTradingBusy() ? "Working..." : "Place and monitor"}
            </Button>
            <Show when={orderResults()}>
              {results => (
                <ul class="flex flex-col gap-1 font-mono text-[11px]">
                  <For each={results()}>
                    {result => (
                      <li>
                        {result.symbol} {result.side} → {result.status}
                        {result.message ? ` (${result.message})` : ""}
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Show>
          </section>

          <section class="flex flex-col gap-3 border border-border p-4">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Open orders
              </h2>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !sessionMatches() ||
                  credentials()?.subaccountId === null ||
                  openOrdersQuery.isFetching
                }
                onClick={() => void openOrdersQuery.refetch()}
              >
                {openOrdersQuery.isFetching ? "Loading..." : "Refresh"}
              </Button>
            </div>
            <Show when={openOrdersQuery.error}>
              <p class="text-[11px] text-destructive">
                {getErrorMessage(openOrdersQuery.error)}
              </p>
            </Show>
            <div class="overflow-x-auto">
              <table class="w-full border-collapse text-left font-mono text-[11px]">
                <thead>
                  <tr class="border-b border-border text-muted-foreground">
                    <th class="px-2 py-1 font-medium">Symbol</th>
                    <th class="px-2 py-1 font-medium">Side</th>
                    <th class="px-2 py-1 font-medium">Amount</th>
                    <th class="px-2 py-1 font-medium">Price</th>
                    <th class="px-2 py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <Show
                    when={(openOrdersQuery.data?.length ?? 0) > 0}
                    fallback={
                      <tr>
                        <td class="px-2 py-3 text-muted-foreground" colspan={5}>
                          {openOrdersQuery.isLoading
                            ? "Loading..."
                            : "No open orders"}
                        </td>
                      </tr>
                    }
                  >
                    <For each={openOrdersQuery.data ?? []}>
                      {order => (
                        <tr class="border-b border-border/60">
                          <td class="px-2 py-1">{order.symbol ?? "—"}</td>
                          <td class="px-2 py-1">{order.side ?? "—"}</td>
                          <td class="px-2 py-1">{order.amount ?? "—"}</td>
                          <td class="px-2 py-1">{order.price ?? "—"}</td>
                          <td class="px-2 py-1">
                            {order.info !== undefined &&
                            "order_status" in order.info
                              ? String(order.info.order_status)
                              : (order.status ?? "—")}
                          </td>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            </div>
          </section>
        </Show>
      </main>
    </div>
  )
}

const BalanceSummaryView = (props: {
  summary: DeriveBalanceSummary
}): JSX.Element => {
  const totalEntries = () => Object.entries(props.summary.totals)

  return (
    <div class="flex flex-col gap-3">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
        <dt class="text-muted-foreground">Account value</dt>
        <dd>{props.summary.accountValue}</dd>
        <dt class="text-muted-foreground">Collaterals value</dt>
        <dd>{props.summary.collateralsValue}</dd>
        <dt class="text-muted-foreground">Positions value</dt>
        <dd>{props.summary.positionsValue}</dd>
      </dl>

      <Show
        when={totalEntries().length > 0}
        fallback={
          <p class="text-[11px] text-muted-foreground">No currency totals</p>
        }
      >
        <ul class="flex flex-col gap-1 font-mono text-[11px]">
          <For each={totalEntries()}>
            {entry => (
              <li class="flex justify-between gap-4">
                <span class="text-muted-foreground">{entry[0]}</span>
                <span>{entry[1]}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

const AccountSnapshotView = (props: {
  snapshot: DeriveAccountSnapshot
}): JSX.Element => {
  const allPositions = () =>
    props.snapshot.subaccounts.flatMap(subaccount =>
      subaccount.positions.map(position => ({
        subaccountId: subaccount.subaccountId,
        position,
      })),
    )

  return (
    <div class="flex flex-col gap-4">
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11px]">
        <dt class="text-muted-foreground">Derive wallet</dt>
        <dd class="break-all">{props.snapshot.deriveWallet}</dd>
        <dt class="text-muted-foreground">Subaccounts</dt>
        <dd>{props.snapshot.subaccountIds.join(", ") || "—"}</dd>
      </dl>

      <For each={props.snapshot.subaccounts}>
        {subaccount => <SubaccountCard subaccount={subaccount} />}
      </For>

      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-left font-mono text-[11px]">
          <thead>
            <tr class="border-b border-border text-muted-foreground">
              <th class="px-2 py-1 font-medium">Sub</th>
              <th class="px-2 py-1 font-medium">Symbol</th>
              <th class="px-2 py-1 font-medium">Side</th>
              <th class="px-2 py-1 font-medium">Notional</th>
              <th class="px-2 py-1 font-medium">Entry</th>
              <th class="px-2 py-1 font-medium">uPnL</th>
              <th class="px-2 py-1 font-medium">Lev</th>
            </tr>
          </thead>
          <tbody>
            <Show
              when={allPositions().length > 0}
              fallback={
                <tr>
                  <td class="px-2 py-3 text-muted-foreground" colspan={7}>
                    No open positions
                  </td>
                </tr>
              }
            >
              <For each={allPositions()}>
                {row => (
                  <tr class="border-b border-border/60">
                    <td class="px-2 py-1">{row.subaccountId}</td>
                    <td class="px-2 py-1">{row.position.symbol}</td>
                    <td class="px-2 py-1">
                      {row.position.side === "buy" ? "LONG" : "SHORT"}
                    </td>
                    <td class="px-2 py-1">{row.position.notional}</td>
                    <td class="px-2 py-1">{row.position.entryPrice}</td>
                    <td class="px-2 py-1">{row.position.unrealizedPnl}</td>
                    <td class="px-2 py-1">{row.position.leverage}</td>
                  </tr>
                )}
              </For>
            </Show>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const SubaccountCard = (props: {
  subaccount: DeriveSubaccountSnapshot
}): JSX.Element => (
  <div class="border border-border/70 p-3">
    <p class="mb-2 text-[11px] font-semibold">
      Subaccount {props.subaccount.subaccountId}
    </p>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] sm:grid-cols-3">
      <div>
        <dt class="text-muted-foreground">Equity</dt>
        <dd>{props.subaccount.subaccountValue}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Collateral</dt>
        <dd>{props.subaccount.collateralsValue}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Positions value</dt>
        <dd>{props.subaccount.positionsValue}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Initial margin</dt>
        <dd>{props.subaccount.initialMargin}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Maint. margin</dt>
        <dd>{props.subaccount.maintenanceMargin}</dd>
      </div>
    </dl>
  </div>
)

const TestPage = (): JSX.Element => (
  <>
    <Toaster />
    <TestPageContent />
  </>
)

export default TestPage
