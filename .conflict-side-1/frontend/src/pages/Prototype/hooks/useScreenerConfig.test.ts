import { describe, it, expect } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { useScreenerConfig } from "./useScreenerConfig"

interface TestAsset {
  ticker: string
  sharpe: number
  sortino: number
  beta: number
  volatility: number
  momentum: number
}

const mockAssets: TestAsset[] = [
  {
    ticker: "BTC",
    sharpe: 1.5,
    sortino: 2.0,
    beta: 1.2,
    volatility: 0.5,
    momentum: 0.1,
  },
  {
    ticker: "ETH",
    sharpe: 1.2,
    sortino: 1.8,
    beta: 1.4,
    volatility: 0.6,
    momentum: 0.15,
  },
  {
    ticker: "SOL",
    sharpe: 0.8,
    sortino: 1.0,
    beta: 1.8,
    volatility: 0.8,
    momentum: 0.2,
  },
]

describe("useScreenerConfig", () => {
  describe("sorting", () => {
    it("sorts by sharpe descending by default", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      const sorted = result.sortedAssets
      expect(sorted[0].ticker).toBe("BTC")
      expect(sorted[1].ticker).toBe("ETH")
      expect(sorted[2].ticker).toBe("SOL")
    })

    it("sorts by column ascending when clicked", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.setSortColumn("beta")

      const sorted = result.sortedAssets
      expect(sorted[0].ticker).toBe("BTC")
      expect(sorted[1].ticker).toBe("ETH")
      expect(sorted[2].ticker).toBe("SOL")
    })

    it("toggles sort direction when same column clicked again", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.setSortColumn("beta")
      expect(result.sortDirection).toBe("asc")

      result.setSortColumn("beta")
      expect(result.sortDirection).toBe("desc")

      const sorted = result.sortedAssets
      expect(sorted[0].ticker).toBe("SOL")
      expect(sorted[1].ticker).toBe("ETH")
      expect(sorted[2].ticker).toBe("BTC")
    })

    it("resets to ascending when different column selected", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.setSortColumn("sharpe")
      result.setSortColumn("sharpe")
      expect(result.sortDirection).toBe("desc")

      result.setSortColumn("volatility")
      expect(result.sortDirection).toBe("asc")
      expect(result.sortColumn).toBe("volatility")
    })
  })

  describe("filtering", () => {
    it("filters assets by search query (case insensitive)", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.setSearchQuery("btc")

      expect(result.sortedAssets).toHaveLength(1)
      expect(result.sortedAssets[0].ticker).toBe("BTC")
    })

    it("returns all assets when search query is empty", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.setSearchQuery("")

      expect(result.sortedAssets).toHaveLength(3)
    })

    it("applies both filter and sort", () => {
      const assets = [
        ...mockAssets,
        {
          ticker: "ETHFI",
          sharpe: 0.5,
          sortino: 0.8,
          beta: 1.6,
          volatility: 0.7,
          momentum: 0.12,
        },
      ]

      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => assets }),
      )

      result.setSearchQuery("eth")
      result.setSortColumn("sharpe")

      expect(result.sortedAssets).toHaveLength(2)
      expect(result.sortedAssets[0].ticker).toBe("ETHFI")
      expect(result.sortedAssets[1].ticker).toBe("ETH")
    })
  })

  describe("expansion", () => {
    it("starts with no expanded underlyings", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      expect(result.isExpanded("BTC")).toBe(false)
      expect(result.isExpanded("ETH")).toBe(false)
    })

    it("expands underlying when toggled", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.toggleExpanded("BTC")

      expect(result.isExpanded("BTC")).toBe(true)
      expect(result.isExpanded("ETH")).toBe(false)
    })

    it("collapses expanded underlying when toggled again", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.toggleExpanded("BTC")
      result.toggleExpanded("BTC")

      expect(result.isExpanded("BTC")).toBe(false)
    })

    it("allows multiple underlyings to be expanded", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.toggleExpanded("BTC")
      result.toggleExpanded("ETH")

      expect(result.isExpanded("BTC")).toBe(true)
      expect(result.isExpanded("ETH")).toBe(true)
    })

    it("collapses all when collapseAll is called", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      result.toggleExpanded("BTC")
      result.toggleExpanded("ETH")
      result.collapseAll()

      expect(result.isExpanded("BTC")).toBe(false)
      expect(result.isExpanded("ETH")).toBe(false)
    })
  })

  describe("visible columns", () => {
    it("has default visible columns", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      expect(result.visibleColumns).toContain("sharpe")
    })

    it("toggles column visibility", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      const initialHasSortino = result.visibleColumns.includes("sortino")

      result.toggleColumn("sortino")

      expect(result.visibleColumns.includes("sortino")).toBe(!initialHasSortino)
    })

    it("always keeps at least one column visible", () => {
      const { result } = renderHook(() =>
        useScreenerConfig({ assets: () => mockAssets }),
      )

      for (const col of result.visibleColumns) {
        result.toggleColumn(col)
      }

      expect(result.visibleColumns.length).toBeGreaterThanOrEqual(1)
    })
  })
})
