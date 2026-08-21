import { render, screen } from "@solidjs/testing-library"
import { Router, Route } from "@solidjs/router"
import { describe, it, expect } from "vitest"
import LandingPage from "./index"

describe("LandingPage", () => {
  it("renders the DataClique hero and product cards", () => {
    render(() => (
      <Router url="/">
        <Route path="/" component={LandingPage} />
      </Router>
    ))

    expect(
      screen.getByRole("heading", {
        name: /DATACLIQUE: THE ULTIMATE DEFI SUITE/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText("MONEYMENTUM")).toBeInTheDocument()
    expect(screen.getByText("STRIKE")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /ECOSYSTEM CONTRIBUTIONS/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /EXPLORE REPOSITORIES/i }),
    ).toHaveAttribute("href", "https://github.com/orgs/dataclique/repositories")
    expect(screen.getByRole("link", { name: /^REBALANCE$/i })).toHaveAttribute(
      "href",
      "/portfolio",
    )
    expect(
      screen.queryByLabelText("Search repositories"),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(screen.getByText("SOL")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()
  })
})
