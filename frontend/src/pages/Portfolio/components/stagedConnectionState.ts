/** Mutually exclusive wallet/agent readiness for the staged-changes footer. */
export type StagedConnectionState =
  | "chooseVenue"
  | "agentMissing"
  | "agentLocked"
  | "ready"

export type StagedConnectionInput = {
  /** Hyperliquid public main address known (Reown / remembered). */
  readonly hyperliquidPublicConnected: boolean
  /** Encrypted Hyperliquid agent session stored. */
  readonly hasHyperliquidAgent: boolean
  /** Agent private key unlocked in memory. */
  readonly hyperliquidUnlocked: boolean
  /** Encrypted Derive session stored for the current network. */
  readonly deriveConnected: boolean
  /** Derive session unlocked in memory. */
  readonly deriveUnlocked: boolean
  /** Staged trades include at least one Hyperliquid action. */
  readonly hasHyperliquidStagedChanges: boolean
  /** Staged trades include at least one Derive action. */
  readonly hasDeriveStagedChanges: boolean
}

/**
 * Resolves the staged-changes primary control from the venues the staged plan
 * actually needs -- not "every connected venue must be unlocked".
 *
 * Unlocking Derive alone must clear the PIN field when Hyperliquid is not
 * required for the current staged trades (and vice versa).
 *
 * A stored Hyperliquid agent is never "missing": unlock it (agentLocked) or
 * use it (ready). agentMissing means mint+approve a new agent via Reown.
 */
export const resolveStagedConnectionState = (
  input: StagedConnectionInput,
): StagedConnectionState => {
  const {
    hyperliquidPublicConnected,
    hasHyperliquidAgent,
    hyperliquidUnlocked,
    deriveConnected,
    deriveUnlocked,
    hasHyperliquidStagedChanges,
    hasDeriveStagedChanges,
  } = input

  if (!hyperliquidPublicConnected && !deriveConnected && !hasHyperliquidAgent) {
    return "chooseVenue"
  }

  const hyperliquidReady = hasHyperliquidAgent && hyperliquidUnlocked
  const deriveReady = deriveConnected && deriveUnlocked
  const hasStagedChanges = hasHyperliquidStagedChanges || hasDeriveStagedChanges

  if (hasHyperliquidStagedChanges) {
    if (!hasHyperliquidAgent) {
      return "agentMissing"
    }
    if (!hyperliquidUnlocked) {
      return "agentLocked"
    }
  }

  if (hasDeriveStagedChanges) {
    if (!deriveConnected) {
      return "chooseVenue"
    }
    if (!deriveUnlocked) {
      return "agentLocked"
    }
  }

  if (hasStagedChanges) {
    return "ready"
  }

  // Nothing staged yet: show Rebalance (disabled via canSubmit) when any venue
  // can trade, otherwise prompt only for what is still missing.
  if (deriveReady || hyperliquidReady) {
    return "ready"
  }

  if (deriveConnected && !deriveUnlocked) {
    return "agentLocked"
  }

  if (hasHyperliquidAgent && !hyperliquidUnlocked) {
    return "agentLocked"
  }

  if (hyperliquidPublicConnected && !hasHyperliquidAgent) {
    return "agentMissing"
  }

  return "chooseVenue"
}
