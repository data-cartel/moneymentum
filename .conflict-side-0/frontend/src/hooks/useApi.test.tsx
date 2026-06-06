import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { renderHook, waitFor } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { useDateRange, useAnalysisData, useTokenData } from "./useApi"
import type { Timeframe } from "@/components/ui/timeframe-select"
import type { ParentProps } from "solid-js"

vi.mock("./useTrading", () => ({
  refreshClientData: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return (props: ParentProps) => (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  )
}

describe("useApi hooks with Timeframe type", () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("useDateRange", () => {
    it("accepts valid Timeframe type '1h'", async () => {
      const mockResponse = {
        min_date: "2024-01-01",
        max_date: "2024-12-31",
        last_timestamp: "2024-12-31T23:00:00Z",
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const timeframe: Timeframe = "1h"
      const { result } = renderHook(() => useDateRange(() => timeframe), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/date-range?timeframe=1h",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      expect(result.data).toEqual(mockResponse)
    })

    it("accepts valid Timeframe type '15m'", async () => {
      const mockResponse = {
        min_date: "2024-01-01",
        max_date: "2024-12-31",
        last_timestamp: "2024-12-31T23:00:00Z",
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const timeframe: Timeframe = "15m"
      const { result } = renderHook(() => useDateRange(() => timeframe), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/date-range?timeframe=15m",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })

    it("enforces Timeframe type safety", () => {
      const validTimeframes: Timeframe[] = ["1h", "15m"]

      validTimeframes.forEach(tf => {
        expect(tf).toMatch(/^(1h|15m)$/)
      })
    })
  })

  describe("useAnalysisData", () => {
    it("accepts Timeframe type in params", async () => {
      const mockResponse = {
        data: [],
        message: null,
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const params = {
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        timeframe: "1h" as Timeframe,
      }

      const { result } = renderHook(() => useAnalysisData(() => params), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/data?timeframe=1h",
        expect.objectContaining({
          method: "POST",
        }),
      )
    })

    it("constructs correct API URL with timeframe parameter", async () => {
      const mockResponse = {
        data: [],
        message: null,
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const params = {
        startDate: "2024-01-01",
        endDate: "2024-01-31",
        timeframe: "15m" as Timeframe,
      }

      const { result } = renderHook(() => useAnalysisData(() => params), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/data?timeframe=15m",
        expect.any(Object),
      )
    })
  })

  describe("useTokenData", () => {
    it("accepts Timeframe type parameter", async () => {
      const mockResponse = {
        data: [],
        message: null,
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const ticker = "BTC"
      const timeframe: Timeframe = "1h"

      const { result } = renderHook(
        () =>
          useTokenData(
            () => ticker,
            () => timeframe,
          ),
        {
          wrapper: createWrapper(),
        },
      )

      await waitFor(() => {
        expect(result.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/token/BTC?timeframe=1h",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })

    it("constructs URL correctly with 15m timeframe", async () => {
      const mockResponse = {
        data: [],
        message: null,
      }

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      })

      const ticker = "ETH"
      const timeframe: Timeframe = "15m"

      const { result } = renderHook(
        () =>
          useTokenData(
            () => ticker,
            () => timeframe,
          ),
        {
          wrapper: createWrapper(),
        },
      )

      await waitFor(() => {
        expect(result.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/token/ETH?timeframe=15m",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    })

    it("does not query when ticker is undefined", () => {
      const timeframe: Timeframe = "1h"

      const { result } = renderHook(
        () =>
          useTokenData(
            () => undefined,
            () => timeframe,
          ),
        {
          wrapper: createWrapper(),
        },
      )

      expect(result.isFetching).toBe(false)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe("Type safety validation", () => {
    it("ensures Timeframe type only allows valid values", () => {
      const valid1h: Timeframe = "1h"
      const valid15m: Timeframe = "15m"

      expect(valid1h).toBe("1h")
      expect(valid15m).toBe("15m")

      const allValid: Timeframe[] = ["1h", "15m"]
      expect(allValid).toHaveLength(2)
    })
  })
})
