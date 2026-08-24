import { describe, expect, it } from "vitest"

import {
  resolveStagedConnectionState,
  type StagedConnectionInput,
} from "./stagedConnectionState"

const base = (
  overrides: Partial<StagedConnectionInput> = {},
): StagedConnectionInput => ({
  hyperliquidPublicConnected: false,
  hasHyperliquidAgent: false,
  hyperliquidUnlocked: false,
  deriveConnected: false,
  deriveUnlocked: false,
  hasHyperliquidStagedChanges: false,
  hasDeriveStagedChanges: false,
  ...overrides,
})

describe("resolveStagedConnectionState", () => {
  it("shows venue chooser when neither wallet is connected", () => {
    expect(resolveStagedConnectionState(base())).toBe("chooseVenue")
  })

  it("shows PIN when only Derive is connected and locked", () => {
    expect(
      resolveStagedConnectionState(
        base({ deriveConnected: true, deriveUnlocked: false }),
      ),
    ).toBe("agentLocked")
  })

  it("is ready when only Derive is connected and unlocked", () => {
    expect(
      resolveStagedConnectionState(
        base({ deriveConnected: true, deriveUnlocked: true }),
      ),
    ).toBe("ready")
  })

  it("prompts for Hyperliquid agent when public HL is connected without Derive", () => {
    expect(
      resolveStagedConnectionState(base({ hyperliquidPublicConnected: true })),
    ).toBe("agentMissing")
  })

  it("unlocks a stored Hyperliquid agent even without a public Reown session", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: false,
          hasHyperliquidStagedChanges: true,
        }),
      ),
    ).toBe("agentLocked")
  })

  it("prompts for Hyperliquid agent when HL trades are staged without an agent", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          deriveConnected: true,
          deriveUnlocked: true,
          hasHyperliquidStagedChanges: true,
        }),
      ),
    ).toBe("agentMissing")
  })

  it("is ready when Derive is unlocked and only Derive is staged", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          deriveConnected: true,
          deriveUnlocked: true,
          hasDeriveStagedChanges: true,
        }),
      ),
    ).toBe("ready")
  })

  it("does not ask for Derive unlock when only Hyperliquid is staged", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: true,
          deriveConnected: true,
          deriveUnlocked: false,
          hasHyperliquidStagedChanges: true,
        }),
      ),
    ).toBe("ready")
  })

  it("shows Rebalance when both venues have unlocked trading sessions", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: true,
          deriveConnected: true,
          deriveUnlocked: true,
        }),
      ),
    ).toBe("ready")
  })

  it("keeps PIN when a staged Hyperliquid agent is still locked", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: false,
          deriveConnected: true,
          deriveUnlocked: true,
          hasHyperliquidStagedChanges: true,
        }),
      ),
    ).toBe("agentLocked")
  })

  it("keeps PIN when staged Derive is still locked", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: true,
          deriveConnected: true,
          deriveUnlocked: false,
          hasDeriveStagedChanges: true,
        }),
      ),
    ).toBe("agentLocked")
  })

  it("asks to connect Derive when Derive trades are staged without Derive", () => {
    expect(
      resolveStagedConnectionState(
        base({
          hyperliquidPublicConnected: true,
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: true,
          hasDeriveStagedChanges: true,
        }),
      ),
    ).toBe("chooseVenue")
  })
})
