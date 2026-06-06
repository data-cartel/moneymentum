import { render } from "@solidjs/testing-library"
import { Router, Route } from "@solidjs/router"
import { describe, it, expect } from "vitest"
import { AppLayout, FullscreenLayout } from "./App"

describe("AppLayout", () => {
  it("renders routed content within the layout", () => {
    const { queryByText, container } = render(() => (
      <Router url="/">
        <Route path="/" component={AppLayout}>
          <Route path="/" component={() => <p>home content</p>} />
        </Route>
      </Router>
    ))

    expect(container.querySelector(".bg-background")).toBeInTheDocument()
    expect(queryByText("home content")).toBeInTheDocument()
  })
})

describe("FullscreenLayout", () => {
  it("renders children without wrapper div", () => {
    const { queryByText, container } = render(() => (
      <Router url="/">
        <Route path="/" component={FullscreenLayout}>
          <Route path="/" component={() => <p>fullscreen content</p>} />
        </Route>
      </Router>
    ))

    expect(
      container.querySelector(".flex.h-screen.flex-col.overflow-hidden"),
    ).not.toBeInTheDocument()
    expect(queryByText("fullscreen content")).toBeInTheDocument()
  })
})
