import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, waitFor } from "@solidjs/testing-library"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"
import MainPage from "./MainPage"

const useDateRangeMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: null as {
      min_date: string
      max_date: string
      last_timestamp: string | null
    } | null,
    error: null as { message: string } | null,
    isLoading: true,
    refetch: vi.fn(),
  })),
)

const useAnalysisDataMock = vi.hoisted(() =>
  vi.fn(() => ({
    data: null as { data: unknown[]; message: string | null } | null,
    error: null as { message: string } | null,
    isLoading: false,
  })),
)

const useReloadDataMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
)

const useStopReloadMock = vi.hoisted(() =>
  vi.fn(() => ({
    mutate: vi.fn(),
  })),
)

vi.mock("@/hooks/useApi", () => ({
  useDateRange: useDateRangeMock,
  useAnalysisData: useAnalysisDataMock,
  useReloadData: useReloadDataMock,
  useStopReload: useStopReloadMock,
}))

vi.mock("@/hooks/useNetwork", () => ({
  useNetwork: vi.fn(() => ({
    isNetworkSwitching: () => false,
    setIsNetworkSwitching: vi.fn(),
  })),
}))

vi.mock("@/components/ui/virtualized-data-table", () => ({
  VirtualizedDataTable: () => <div data-testid="data-table">DataTable</div>,
}))

vi.mock("@/components/ui/date-picker", () => ({
  Calendar22: () => <div data-testid="date-picker">DatePicker</div>,
}))

vi.mock("@/components/ui/timeframe-select", () => ({
  TimeframeSelect: (props: { value: string }) => (
    <div data-testid="timeframe-select">{props.value}</div>
  ),
}))

type AnalysisParams = { startDate: string; endDate: string; timeframe: string }

const getLastAnalysisParams = (): AnalysisParams | undefined => {
  const calls = useAnalysisDataMock.mock.calls as unknown as Array<
    [() => AnalysisParams]
  >
  return calls.at(-1)?.[0]()
}

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

describe("MainPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDateRangeMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
    })
    useAnalysisDataMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    })
    useReloadDataMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
    useStopReloadMock.mockReturnValue({
      mutate: vi.fn(),
    })
  })

  it("shows loading state when date range is loading", async () => {
    render(() => <MainPage />, { wrapper: createWrapper() })

    expect(screen.getByText(/Loading data/)).toBeInTheDocument()
  })

  it("shows main content after data loads", async () => {
    useDateRangeMock.mockReturnValue({
      data: {
        min_date: "2024-01-01T00:00:00Z",
        max_date: "2024-12-31T00:00:00Z",
        last_timestamp: "2024-12-31T23:00:00Z",
      },
      error: null,
      isLoading: false,
    })
    useAnalysisDataMock.mockReturnValue({
      data: { data: [], message: null },
      error: null,
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.queryByText(/Loading data/)).not.toBeInTheDocument()
    })
    expect(screen.getByTestId("data-table")).toBeInTheDocument()
  })

  it("shows error state when analysis query fails", async () => {
    useDateRangeMock.mockReturnValue({
      data: {
        min_date: "2024-01-01T00:00:00Z",
        max_date: "2024-12-31T00:00:00Z",
        last_timestamp: "2024-12-31T23:00:00Z",
      },
      error: null,
      isLoading: false,
    })
    useAnalysisDataMock.mockReturnValue({
      data: null,
      error: { message: "Analysis failed" },
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText("Unable to load data")).toBeInTheDocument()
    })
  })

  it("shows error state when date range query fails", async () => {
    useDateRangeMock.mockReturnValue({
      data: null,
      error: { message: "Date range failed" },
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText("Unable to load data")).toBeInTheDocument()
    })
  })

  it("shows stop button when reload is pending", async () => {
    useDateRangeMock.mockReturnValue({
      data: {
        min_date: "2024-01-01T00:00:00Z",
        max_date: "2024-12-31T00:00:00Z",
        last_timestamp: "2024-12-31T23:00:00Z",
      },
      error: null,
      isLoading: false,
    })
    useAnalysisDataMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
    })
    useReloadDataMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    expect(screen.getByText("Stop reloading")).toBeInTheDocument()
  })

  it("calls useAnalysisData with maxDate for both start and end", async () => {
    useDateRangeMock.mockReturnValue({
      data: {
        min_date: "2024-01-01T00:00:00Z",
        max_date: "2024-06-15T00:00:00Z",
        last_timestamp: "2024-06-15T23:00:00Z",
      },
      error: null,
      isLoading: false,
    })
    useAnalysisDataMock.mockReturnValue({
      data: { data: [], message: null },
      error: null,
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(useAnalysisDataMock).toHaveBeenCalled()
      const params = getLastAnalysisParams()
      expect(params?.startDate).toBe("2024-06-15")
      expect(params?.endDate).toBe("2024-06-15")
      expect(params?.timeframe).toBe("1h")
    })
  })

  it("strips time component from dates, using only YYYY-MM-DD", async () => {
    useDateRangeMock.mockReturnValue({
      data: {
        min_date: "2024-01-15T12:30:45.123Z",
        max_date: "2024-06-20T18:45:30.999Z",
        last_timestamp: "2024-06-20T23:59:59Z",
      },
      error: null,
      isLoading: false,
    })
    useAnalysisDataMock.mockReturnValue({
      data: { data: [], message: null },
      error: null,
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(useAnalysisDataMock).toHaveBeenCalled()
      const params = getLastAnalysisParams()
      expect(params?.startDate).toBe("2024-06-20")
      expect(params?.endDate).toBe("2024-06-20")
    })
  })

  it("calls useAnalysisData with empty strings when dateRange has no data", async () => {
    useDateRangeMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
    })
    useAnalysisDataMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    expect(useAnalysisDataMock).toHaveBeenCalled()
    const params = getLastAnalysisParams()
    expect(params?.startDate).toBe("")
    expect(params?.endDate).toBe("")
  })

  it("displays message from analysis data when present", async () => {
    useDateRangeMock.mockReturnValue({
      data: {
        min_date: "2024-01-01T00:00:00Z",
        max_date: "2024-12-31T00:00:00Z",
        last_timestamp: "2024-12-31T23:00:00Z",
      },
      error: null,
      isLoading: false,
    })
    useAnalysisDataMock.mockReturnValue({
      data: { data: [], message: "Data is stale" },
      error: null,
      isLoading: false,
    })

    render(() => <MainPage />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText("Data is stale")).toBeInTheDocument()
    })
  })
})
