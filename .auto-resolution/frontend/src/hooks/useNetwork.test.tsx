import { describe, it, expect } from "vitest"
import { renderHook } from "@solidjs/testing-library"
import { useNetwork } from "./useNetwork"
import { NetworkProvider } from "@/contexts/NetworkContext"
import type { ParentProps } from "solid-js"

const createWrapper = () => {
  return (props: ParentProps) => (
    <NetworkProvider>{props.children}</NetworkProvider>
  )
}

describe("useNetwork", () => {
  it("throws error when used outside NetworkProvider", () => {
    expect(() => {
      renderHook(() => useNetwork())
    }).toThrow("useNetwork must be used within a NetworkProvider")
  })

  it("returns isNetworkSwitching as false initially", () => {
    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    })

    expect(result.isNetworkSwitching()).toBe(false)
  })

  it("provides setIsNetworkSwitching function", () => {
    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    })

    expect(typeof result.setIsNetworkSwitching).toBe("function")
  })

  it("updates isNetworkSwitching when setIsNetworkSwitching is called", () => {
    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    })

    expect(result.isNetworkSwitching()).toBe(false)

    result.setIsNetworkSwitching(true)

    expect(result.isNetworkSwitching()).toBe(true)

    result.setIsNetworkSwitching(false)

    expect(result.isNetworkSwitching()).toBe(false)
  })
})
