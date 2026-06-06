import { describe, expect, it } from "vitest"
import { render, screen } from "@solidjs/testing-library"

import { FactorsPanel } from "./FactorsPanel"

const betaMethodology = {
  exposureLabel: "B to BTC",
  benchmark: "BTC perpetual on Hyperliquid",
  interval: "daily log returns",
  lookback: "365 calendar days",
}

describe("FactorsPanel", () => {
  it("uses the selected beta exposure label in default exposures", () => {
    render(() => (
      <FactorsPanel
        beta={0.59}
        isBetaLoading={false}
        betaError={null}
        excludedBetaSymbols={[]}
        betaDataAgeHours={2}
        isBetaDataStale={false}
        betaMethodology={{
          exposureLabel: "B to QQQ",
          benchmark: "QQQ ETF",
          interval: "weekly log returns",
          lookback: "52 calendar weeks",
        }}
      />
    ))

    expect(screen.getAllByText("B to QQQ")).toHaveLength(3)
  })

  it("warns when beta data is stale", () => {
    render(() => (
      <FactorsPanel
        beta={0.59}
        isBetaLoading={false}
        betaError={null}
        excludedBetaSymbols={[]}
        betaDataAgeHours={26}
        isBetaDataStale={true}
        betaMethodology={betaMethodology}
      />
    ))

    expect(screen.getByText("Beta data is 26h old")).toBeInTheDocument()
  })

  it("does not warn when beta data is fresh", () => {
    render(() => (
      <FactorsPanel
        beta={0.59}
        isBetaLoading={false}
        betaError={null}
        excludedBetaSymbols={[]}
        betaDataAgeHours={2}
        isBetaDataStale={false}
        betaMethodology={betaMethodology}
      />
    ))

    expect(screen.queryByText("Beta data is 2h old")).not.toBeInTheDocument()
  })

  it("does not warn when beta data age is unknown", () => {
    render(() => (
      <FactorsPanel
        beta={0.59}
        isBetaLoading={false}
        betaError={null}
        excludedBetaSymbols={[]}
        betaDataAgeHours={null}
        isBetaDataStale={true}
        betaMethodology={betaMethodology}
      />
    ))

    expect(screen.queryByText(/Beta data is .* old/)).not.toBeInTheDocument()
  })

  it("does not render numeric beta when beta data age is unknown", () => {
    render(() => (
      <FactorsPanel
        beta={0.59}
        isBetaLoading={false}
        betaError={null}
        excludedBetaSymbols={[]}
        betaDataAgeHours={null}
        isBetaDataStale={false}
        betaMethodology={betaMethodology}
      />
    ))

    expect(screen.queryByText("+0.59")).not.toBeInTheDocument()
    expect(screen.getAllByText("--").length).toBeGreaterThan(0)
  })
})
