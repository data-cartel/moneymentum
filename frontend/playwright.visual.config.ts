import { defineConfig, devices } from "@playwright/test"
import { chromiumExecutablePath } from "./playwright-chromium"

const visualServerPort = 4173
const visualServerHost = "127.0.0.1"
const visualServerOrigin = `http://${visualServerHost}:${visualServerPort}`

export default defineConfig({
  testDir: "./src/visual",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: visualServerOrigin,
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : {},
  },
  webServer: {
    command: `bunx vite --host ${visualServerHost} --port ${visualServerPort}`,
    url: visualServerOrigin,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
