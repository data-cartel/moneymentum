import { defineConfig, devices } from "@playwright/test"
import { chromiumExecutablePath } from "./playwright-chromium"

const frontendPort = 4174
const frontendHost = "127.0.0.1"
const frontendOrigin = `http://${frontendHost}:${frontendPort}`
const backendHealthUrl = "http://127.0.0.1:8000/health"
const hyperliquidMockHealthUrl = "http://127.0.0.1:8022/health"

export default defineConfig({
  testDir: "./src/contract",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: frontendOrigin,
    launchOptions: chromiumExecutablePath
      ? { executablePath: chromiumExecutablePath }
      : {},
  },
  webServer: [
    {
      command: "bun run contract:hyperliquid-mock",
      url: hyperliquidMockHealthUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "bun run contract:backend",
      url: backendHealthUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
    },
    {
      command: `bunx vite --host ${frontendHost} --port ${frontendPort}`,
      url: frontendOrigin,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
