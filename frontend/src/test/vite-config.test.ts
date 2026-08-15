import { describe, expect, it } from "vitest"

import viteConfig from "../../vite.config"

describe("Vite development server watcher", () => {
  it("ignores only runtime-managed environment trees", () => {
    expect(viteConfig.server?.watch?.ignored).toEqual([
      "**/.devenv/**",
      "**/.direnv/**",
    ])
  })
})
