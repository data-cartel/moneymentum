import { expect, test } from "@playwright/test"

test("prototype default layout", async ({ page }) => {
  await page.goto("/prototype")
  await page.getByText("POSITIONS", { exact: true }).waitFor()
  await page.waitForLoadState("networkidle")
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.locator("canvas").first().waitFor({ timeout: 15_000 })

  await expect(page).toHaveScreenshot("prototype-default.png", {
    fullPage: true,
    animations: "disabled",
  })
})
