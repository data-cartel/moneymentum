import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const visualServerPort = 4173
const visualServerHost = "127.0.0.1"
const visualServerOrigin = `http://${visualServerHost}:${visualServerPort}`

const resolveNixChromiumExecutable = (): string | undefined => {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersPath) {
    return undefined
  }

  const headlessShellDirectoryNames = readdirSync(browsersPath).filter(name =>
    name.startsWith("chromium_headless_shell-"),
  )

  for (const directoryName of headlessShellDirectoryNames) {
    const headlessShellDirectory = path.join(browsersPath, directoryName)
    const platformDirectoryNames = readdirSync(headlessShellDirectory)

    for (const platformDirectoryName of platformDirectoryNames) {
      const candidate = path.join(
        headlessShellDirectory,
        platformDirectoryName,
        "chrome-headless-shell",
      )
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  return undefined
}

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  resolveNixChromiumExecutable()

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
