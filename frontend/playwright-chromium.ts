import { existsSync, readdirSync } from "node:fs"
import path from "node:path"

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

/// The chromium binary playwright should launch: an explicit override, the
/// nix-provided headless shell, or playwright's own download when undefined.
export const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  resolveNixChromiumExecutable()
