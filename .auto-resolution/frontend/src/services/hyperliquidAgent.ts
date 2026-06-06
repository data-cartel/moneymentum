import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { ExchangeClient, HttpTransport } from "@nktkas/hyperliquid"
import {
  createWalletClient,
  custom,
  getAddress,
  type EIP1193Provider,
} from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { arbitrum } from "viem/chains"

import type { NetworkMode, WalletCredentials } from "@/contexts/wallet-context"

/** Agent name Hyperliquid records for this app (max 16 chars). */
const MONEYMENTUM_AGENT_NAME = "moneymentum"

/** Zero address: Hyperliquid deregisters a named agent when approved to this. */
const REVOKED_AGENT_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const

export class ReownWalletUnavailable extends Data.TaggedError(
  "ReownWalletUnavailable",
)<Record<string, never>> {}

export class ReownWalletRejected extends Data.TaggedError(
  "ReownWalletRejected",
)<{
  readonly cause: unknown
}> {}

export class ApproveAgentFailed extends Data.TaggedError("ApproveAgentFailed")<{
  readonly cause: unknown
}> {}

export class RevokeAgentFailed extends Data.TaggedError("RevokeAgentFailed")<{
  readonly cause: unknown
}> {}

export type AuthorizeHyperliquidAgentFailure =
  | ReownWalletUnavailable
  | ReownWalletRejected
  | ApproveAgentFailed

export type RevokeHyperliquidAgentFailure =
  | ReownWalletUnavailable
  | ReownWalletRejected
  | RevokeAgentFailed

export interface GeneratedHyperliquidAgent {
  agentAddress: string
  agentPrivateKey: `0x${string}`
}

/**
 * Generates a local Hyperliquid API agent keypair (never leaves the browser
 * except as an encrypted blob after the caller persists it).
 */
export const generateHyperliquidAgent = (): GeneratedHyperliquidAgent => {
  const agentPrivateKey = generatePrivateKey()
  const agent = privateKeyToAccount(agentPrivateKey)
  return {
    agentAddress: agent.address,
    agentPrivateKey,
  }
}

/**
 * Asks the connected main wallet (via Reown EIP-1193 provider) to approve a
 * trading agent on Hyperliquid. The agent private key stays in-app for ccxt.
 */
export const approveHyperliquidAgent = (
  provider: EIP1193Provider,
  mainAddress: string,
  agentAddress: string,
  networkMode: NetworkMode,
): Effect.Effect<void, AuthorizeHyperliquidAgentFailure> =>
  Effect.gen(function* () {
    const normalizedMain = yield* Effect.try({
      try: () => getAddress(mainAddress),
      catch: cause => new ReownWalletRejected({ cause }),
    })

    const normalizedAgent = yield* Effect.try({
      try: () => getAddress(agentAddress),
      catch: cause => new ReownWalletRejected({ cause }),
    })

    const wallet = createWalletClient({
      account: normalizedMain,
      chain: arbitrum,
      transport: custom(provider),
    })

    yield* Effect.tryPromise({
      try: async () => {
        const transport = new HttpTransport({
          isTestnet: networkMode === "testnet",
        })
        const exchange = new ExchangeClient({ transport, wallet })
        await exchange.approveAgent({
          agentAddress: normalizedAgent,
          agentName: MONEYMENTUM_AGENT_NAME,
        })
      },
      catch: cause => new ApproveAgentFailed({ cause }),
    })
  })

/**
 * Asks the connected main wallet to revoke Moneymentum's named Hyperliquid
 * agent (approveAgent with the zero address + matching agent name).
 */
export const revokeHyperliquidAgent = (
  provider: EIP1193Provider,
  mainAddress: string,
  networkMode: NetworkMode,
): Effect.Effect<void, RevokeHyperliquidAgentFailure> =>
  Effect.gen(function* () {
    const normalizedMain = yield* Effect.try({
      try: () => getAddress(mainAddress),
      catch: cause => new ReownWalletRejected({ cause }),
    })

    const wallet = createWalletClient({
      account: normalizedMain,
      chain: arbitrum,
      transport: custom(provider),
    })

    yield* Effect.tryPromise({
      try: async () => {
        const transport = new HttpTransport({
          isTestnet: networkMode === "testnet",
        })
        const exchange = new ExchangeClient({ transport, wallet })
        await exchange.approveAgent({
          agentAddress: REVOKED_AGENT_ADDRESS,
          agentName: MONEYMENTUM_AGENT_NAME,
        })
      },
      catch: cause => new RevokeAgentFailed({ cause }),
    })
  })

/**
 * Full authorize flow: generate agent, then have the connected wallet approve
 * it. Caller is responsible for PIN encryption / persistence around this.
 */
export const authorizeHyperliquidAgent = (
  provider: EIP1193Provider | null,
  mainAddress: string,
  networkMode: NetworkMode,
): Effect.Effect<WalletCredentials, AuthorizeHyperliquidAgentFailure> =>
  Effect.gen(function* () {
    if (provider === null) {
      return yield* Effect.fail(new ReownWalletUnavailable())
    }

    if (mainAddress.trim() === "") {
      return yield* Effect.fail(new ReownWalletUnavailable())
    }

    const agent = generateHyperliquidAgent()

    yield* approveHyperliquidAgent(
      provider,
      mainAddress,
      agent.agentAddress,
      networkMode,
    )

    return {
      accountAddress: getAddress(mainAddress),
      apiWalletAddress: agent.agentAddress,
      privateKey: agent.agentPrivateKey,
    }
  })
