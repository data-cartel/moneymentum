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

  it("marks holdings as read-only and explains they cannot trade", () => {
    const address = "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"

    render(() => (
      <ReadonlyBtcPanel
        rows={[
          {
            address,
            includeInBeta: true,
            quantityBtc: 0.5,
            notionalUsd: 50_000,
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

    const readOnlyIndicator = screen.getByLabelText(
      "Read-only — cannot trade",
    )
    expect(readOnlyIndicator).toHaveTextContent("Read-only")
    expect(readOnlyIndicator.querySelector("svg")).not.toBeNull()
    expect(screen.getByText(address).parentElement).toHaveClass(
      "text-muted-foreground",
    )
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
