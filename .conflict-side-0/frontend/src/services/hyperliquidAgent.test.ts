import { describe, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import type { EIP1193Provider } from "viem"

import {
  ApproveAgentFailed,
  RevokeAgentFailed,
  ReownWalletUnavailable,
  authorizeHyperliquidAgent,
  generateHyperliquidAgent,
  revokeHyperliquidAgent,
} from "./hyperliquidAgent"

const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const AGENT_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
const AGENT_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const { approveAgent } = vi.hoisted(() => ({
  approveAgent: vi.fn(),
}))

vi.mock("@nktkas/hyperliquid", () => ({
  HttpTransport: vi.fn(),
  ExchangeClient: class ExchangeClient {
    approveAgent = approveAgent
  },
}))

vi.mock("viem/accounts", async () => {
  const actual =
    await vi.importActual<typeof import("viem/accounts")>("viem/accounts")
  return {
    ...actual,
    generatePrivateKey: () => AGENT_PRIVATE_KEY,
  }
})

describe("generateHyperliquidAgent", () => {
  it("returns a deterministic agent from the mocked private key", () => {
    const agent = generateHyperliquidAgent()

    expect(agent.agentPrivateKey).toBe(AGENT_PRIVATE_KEY)
    expect(agent.agentAddress).toBe(AGENT_ADDRESS)
  })
})

describe("authorizeHyperliquidAgent", () => {
  it("fails when no provider is available", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(authorizeHyperliquidAgent(null, ANVIL_ADDRESS, "testnet")),
    )

    expect(failure).toBeInstanceOf(ReownWalletUnavailable)
  })

  it("approves a trading agent and returns main + agent credentials", async () => {
    approveAgent.mockReset()
    approveAgent.mockResolvedValue({ status: "ok" })

    const provider = {
      request: vi.fn(),
    } as unknown as EIP1193Provider

    const credentials = await Effect.runPromise(
      authorizeHyperliquidAgent(provider, ANVIL_ADDRESS, "mainnet"),
    )

    expect(approveAgent).toHaveBeenCalledWith({
      agentAddress: AGENT_ADDRESS,
      agentName: "moneymentum",
    })
    expect(credentials.accountAddress).toBe(ANVIL_ADDRESS)
    expect(credentials.apiWalletAddress).toBe(AGENT_ADDRESS)
    expect(credentials.privateKey).toBe(AGENT_PRIVATE_KEY)
  })

  it("maps approveAgent failure to ApproveAgentFailed", async () => {
    approveAgent.mockReset()
    approveAgent.mockRejectedValue(new Error("venue rejected"))

    const provider = {
      request: vi.fn(),
    } as unknown as EIP1193Provider

    const failure = await Effect.runPromise(
      Effect.flip(
        authorizeHyperliquidAgent(provider, ANVIL_ADDRESS, "testnet"),
      ),
    )

    expect(failure).toBeInstanceOf(ApproveAgentFailed)
  })
})

describe("revokeHyperliquidAgent", () => {
  it("fails when main address is invalid", async () => {
    const provider = {
      request: vi.fn(),
    } as unknown as EIP1193Provider

    const failure = await Effect.runPromise(
      Effect.flip(
        revokeHyperliquidAgent(provider, "not-an-address", "testnet"),
      ),
    )

    expect(failure._tag).toBe("ReownWalletRejected")
  })

  it("approves the zero address under the Moneymentum agent name", async () => {
    approveAgent.mockReset()
    approveAgent.mockResolvedValue({ status: "ok" })

    const provider = {
      request: vi.fn(),
    } as unknown as EIP1193Provider

    await Effect.runPromise(
      revokeHyperliquidAgent(provider, ANVIL_ADDRESS, "mainnet"),
    )

    expect(approveAgent).toHaveBeenCalledWith({
      agentAddress: ZERO_ADDRESS,
      agentName: "moneymentum",
    })
  })

  it("maps approveAgent failure to RevokeAgentFailed", async () => {
    approveAgent.mockReset()
    approveAgent.mockRejectedValue(new Error("venue rejected"))

    const provider = {
      request: vi.fn(),
    } as unknown as EIP1193Provider

    const failure = await Effect.runPromise(
      Effect.flip(revokeHyperliquidAgent(provider, ANVIL_ADDRESS, "testnet")),
    )

    expect(failure).toBeInstanceOf(RevokeAgentFailed)
  })
})
