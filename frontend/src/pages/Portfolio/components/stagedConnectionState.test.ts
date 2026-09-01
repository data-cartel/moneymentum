import { describe, expect, it } from "vitest"

import {
  resolveStagedConnectionState,
  type StagedConnectionInput,
} from "./stagedConnectionState"

const connectionInput = (
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
  it("never returns agentMissing for Derive-only staged changes", () => {
    expect(
      resolveStagedConnectionState(
        connectionInput({
          deriveConnected: true,
          deriveUnlocked: true,
          hasDeriveStagedChanges: true,
        }),
      ),
    ).toBe("ready")
    expect(
      resolveStagedConnectionState(
        connectionInput({
          hasDeriveStagedChanges: true,
        }),
      ),
    ).toBe("chooseVenue")
    expect(
      resolveStagedConnectionState(
        connectionInput({
          deriveConnected: true,
          hasDeriveStagedChanges: true,
        }),
      ),
    ).toBe("agentLocked")
  })

  it("ignores Derive lock state for Hyperliquid-only staged changes", () => {
    expect(
      resolveStagedConnectionState(
        connectionInput({
          hasHyperliquidAgent: true,
          hyperliquidUnlocked: true,
          deriveConnected: true,
          deriveUnlocked: false,
          hasHyperliquidStagedChanges: true,
        }),
      ),
    ).toBe("ready")
  })

  it("returns ready when Hyperliquid is ready and Derive is locked with Hyperliquid-only staged changes", () => {
    expect(
      resolveStagedConnectionState(
        connectionInput({
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

  it("returns chooseVenue when nothing is connected, unlocked, or staged", () => {
    expect(resolveStagedConnectionState(connectionInput())).toBe("chooseVenue")
  })
})
