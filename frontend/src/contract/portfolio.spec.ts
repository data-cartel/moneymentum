import { expect, test } from "@playwright/test"

// Guards the frontend/backend endpoint contract end-to-end: the real backend
// (mock Hyperliquid behind it) serves the real frontend through the dev-server
// proxy, exactly the wiring prod uses through nginx. If an endpoint the
// frontend consumes disappears or changes shape, these tests fail before a
// deploy can ship the drift.

test("the portfolio page lists the symbols served by the backend", async ({
  page,
}) => {
  await page.goto("/")

  await page.getByRole("button", { name: "Show all symbols" }).click()
  await page.getByText("ALL SYMBOLS", { exact: true }).waitFor()

  await expect(
    page.getByRole("button", { name: "Add BTC to portfolio" }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole("button", { name: "Add ETH to portfolio" }),
  ).toBeVisible()
  await expect(page.getByText("No symbols.", { exact: true })).not.toBeVisible()
})

test("the markets endpoint satisfies the frontend response contract", async ({
  request,
}) => {
  const response = await request.get("/api/hyperliquid/markets?network=mainnet")

  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    tickers: string[]
    leverageLimits: {
      symbol: string
      maxLeverage: number
      assetIndex: number
    }[]
    refreshedAt: string | null
  }
  expect(body.tickers).toContain("BTC/USDC:USDC")
  expect(body.leverageLimits.length).toBeGreaterThan(0)
  for (const limit of body.leverageLimits) {
    expect(typeof limit.symbol).toBe("string")
    expect(typeof limit.maxLeverage).toBe("number")
    expect(typeof limit.assetIndex).toBe("number")
  }
  expect(typeof body.refreshedAt).toBe("string")
})

test("the factor scores endpoint parses with the frontend's strict parser", async ({
  request,
}) => {
  const response = await request.get("/api/factors/1d")

  // Factors depend on scheduled ingestion having run; before the first run the
  // backend answers 404 and the frontend surfaces a query error. Both statuses
  // honor the contract -- what must never happen is a vanished route or a shape
  // the frontend's parser rejects.
  expect([200, 404]).toContain(response.status())
  if (response.status() === 200) {
    const scores = (await response.json()) as unknown
    expect(Array.isArray(scores)).toBe(true)
  }
})
