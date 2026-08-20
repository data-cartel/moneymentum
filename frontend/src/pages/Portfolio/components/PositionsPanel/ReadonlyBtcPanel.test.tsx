import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@solidjs/testing-library"
import userEvent from "@testing-library/user-event"

import { INVALID_BITCOIN_ADDRESS_MESSAGE } from "../../hooks/bitcoinAddress"
import { ReadonlyBtcPanel } from "./ReadonlyBtcPanel"

describe("ReadonlyBtcPanel", () => {
  it("shows address validation errors without clearing the address input", async () => {
    const user = userEvent.setup()
    const addAddress = vi.fn(() => false)

    render(() => (
      <ReadonlyBtcPanel
        rows={[]}
        isLoading={false}
        error={null}
        validationError={INVALID_BITCOIN_ADDRESS_MESSAGE}
        onAddAddress={addAddress}
        onRemoveAddress={vi.fn()}
        onIncludeInBetaChange={vi.fn()}
      />
    ))

    const addressInput = screen.getByPlaceholderText("BTC address")
    await user.type(addressInput, "not-a-btc-address")
    await user.click(screen.getByRole("button", { name: "+" }))

    expect(
      screen.getByText(INVALID_BITCOIN_ADDRESS_MESSAGE),
    ).toBeInTheDocument()
    expect(addressInput).toHaveValue("not-a-btc-address")
    expect(addAddress).toHaveBeenCalledWith("not-a-btc-address")
  })

  it("shows placeholders instead of zero balances while exposure is loading", () => {
    const { container } = render(() => (
      <ReadonlyBtcPanel
        rows={[
          {
            address: "bc1qexampleaddress",
            includeInBeta: true,
            quantityBtc: 0,
            notionalUsd: 0,
          },
        ]}
        isLoading={true}
        error={null}
        validationError={null}
        onAddAddress={vi.fn()}
        onRemoveAddress={vi.fn()}
        onIncludeInBetaChange={vi.fn()}
      />
    ))

    expect(screen.getByTitle("bc1qexampleaddress")).toBeInTheDocument()
    expect(screen.queryByText("0.000000 BTC")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(2)
  })

  it("shows exposure values once loading finishes", () => {
    render(() => (
      <ReadonlyBtcPanel
        rows={[
          {
            address: "bc1qexampleaddress",
            includeInBeta: true,
            quantityBtc: 1.5,
            notionalUsd: 90000,
          },
        ]}
        isLoading={false}
        error={null}
        validationError={null}
        onAddAddress={vi.fn()}
        onRemoveAddress={vi.fn()}
        onIncludeInBetaChange={vi.fn()}
      />
    ))

    expect(screen.getByText("1.500000 BTC")).toBeInTheDocument()
    expect(screen.getByText("$90,000")).toBeInTheDocument()
  })

  it("shows validation and exposure fetch errors together", () => {
    render(() => (
      <ReadonlyBtcPanel
        rows={[]}
        isLoading={false}
        error="readonly exposure request failed"
        validationError={INVALID_BITCOIN_ADDRESS_MESSAGE}
        onAddAddress={vi.fn()}
        onRemoveAddress={vi.fn()}
        onIncludeInBetaChange={vi.fn()}
      />
    ))

    expect(
      screen.getByText(INVALID_BITCOIN_ADDRESS_MESSAGE),
    ).toBeInTheDocument()
    expect(
      screen.getByText("readonly exposure request failed"),
    ).toBeInTheDocument()
  })
})
