import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"

import { useReadonlyPortfolioState } from "./useReadonlyPortfolioState"
import type { NetworkMode } from "@/contexts/wallet-context"

const walletState = vi.hoisted(() => ({
  networkMode: "testnet" as NetworkMode,
}))

vi.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    networkMode: () => walletState.networkMode,
  }),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}

const storageKey = (networkMode: NetworkMode) =>
  `portfolio-readonly-btc-addresses:${networkMode}`

const testnetAddress = "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn"
const testnetBech32Address =
  "tb1qqltm70wyz734t9k8d9w70uuhyxnemyh56d5ra8rtw082ytd7ywmsqudq5e"
const mainnetAddress = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"

describe("useReadonlyPortfolioState", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    walletState.networkMode = "testnet"
    localStorage.clear()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ubtc_price_usd: 0,
        positions: [],
        gross_long_usd: 0,
        gross_short_usd: 0,
        net_usd: 0,
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it("restores only valid readonly btc entries for the active network", () => {
    localStorage.setItem(
      storageKey("mainnet"),
      JSON.stringify([{ address: mainnetAddress, includeInBeta: true }]),
    )
    localStorage.setItem(
      storageKey("testnet"),
      JSON.stringify([
        { address: testnetAddress, includeInBeta: false },
        { address: mainnetAddress, includeInBeta: true },
      ]),
    )

    const { result } = renderHook(() => useReadonlyPortfolioState(), {
      wrapper: createWrapper(),
    })

    expect(result.rows).toEqual([
      {
        address: testnetAddress,
        includeInBeta: false,
        quantityBtc: 0,
        notionalUsd: 0,
      },
    ])
  })

  it("persists readonly btc entries to the active network key", () => {
    const { result } = renderHook(() => useReadonlyPortfolioState(), {
      wrapper: createWrapper(),
    })

    expect(result.addAddress(testnetAddress)).toBe(true)

    expect(localStorage.getItem("portfolio-readonly-btc-addresses")).toBeNull()
    expect(localStorage.getItem(storageKey("mainnet"))).toBeNull()
    expect(
      JSON.parse(localStorage.getItem(storageKey("testnet")) ?? "[]"),
    ).toEqual([
      {
        address: testnetAddress,
        includeInBeta: true,
      },
    ])
  })

  it("canonicalizes and deduplicates bech32 address casing when restoring entries", () => {
    localStorage.setItem(
      storageKey("testnet"),
      JSON.stringify([
        { address: testnetBech32Address.toUpperCase(), includeInBeta: true },
        { address: testnetBech32Address, includeInBeta: false },
      ]),
    )

    const { result } = renderHook(() => useReadonlyPortfolioState(), {
      wrapper: createWrapper(),
    })

    expect(result.rows.map(row => row.address)).toEqual([testnetBech32Address])
  })

  it("deduplicates bech32 address casing variants when adding entries", () => {
    const { result } = renderHook(() => useReadonlyPortfolioState(), {
      wrapper: createWrapper(),
    })

    expect(result.addAddress(testnetBech32Address)).toBe(true)
    expect(result.addAddress(testnetBech32Address.toUpperCase())).toBe(false)

    expect(result.rows.map(row => row.address)).toEqual([testnetBech32Address])
  })
})
