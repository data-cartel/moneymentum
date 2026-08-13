/// <reference types="vitest" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import solid from "vite-plugin-solid"
import { defineConfig, type Plugin } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

const stripApiPrefix = (proxyPath: string): string =>
  proxyPath.replace(/^\/api/, "")

const netStub = path.resolve(__dirname, "./src/stubs/net.ts")

// These WalletConnect utils ship ESM under dist/esm but only declare CJS
// "main" in package.json. Resolve from each importer so this works with both
// Bun's local hoisting and bun2nix's isolated dependency layout.
const walletConnectEsmPackages = new Set([
  "@walletconnect/time",
  "@walletconnect/environment",
  "@walletconnect/window-getters",
  "@walletconnect/window-metadata",
])

const walletConnectEsmResolver = (): Plugin => ({
  name: "walletconnect-esm-resolver",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!importer || !walletConnectEsmPackages.has(source)) return null

    const resolved = await this.resolve(source, importer, {
      ...options,
      skipSelf: true,
    })
    if (!resolved) return null

    return {
      ...resolved,
      id: resolved.id.replace("/dist/cjs/index.js", "/dist/esm/index.js"),
    }
  },
})

export default defineConfig({
  base: "/",
  plugins: [
    solid(),
    tailwindcss(),
    walletConnectEsmResolver(),
    // Buffer/process for ccxt. Keep `global` off so AppKit + lit-html can be
    // prebundled (`var global = globalThis` must not clash with a shim export).
    nodePolyfills({
      exclude: ["net"],
      globals: {
        Buffer: true,
        global: false,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  optimizeDeps: {
    include: [
      "@reown/appkit",
      "@reown/appkit-adapter-ethers",
      "@reown/appkit/networks",
      "@walletconnect/time",
      "@walletconnect/environment",
      "@walletconnect/window-getters",
      "@walletconnect/window-metadata",
      "viem",
      "viem/accounts",
      "viem/chains",
      "@nktkas/hyperliquid",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "node:net": netStub,
      "net": netStub,
      "socks-proxy-agent": path.resolve(__dirname, "./src/stubs/empty.ts"),
      "http-proxy-agent": path.resolve(__dirname, "./src/stubs/empty.ts"),
      "https-proxy-agent": path.resolve(__dirname, "./src/stubs/empty.ts"),
    },
  },
  build: {
    chunkSizeWarningLimit: 6000,
    target: "esnext",
  },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api/hyperliquid": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: stripApiPrefix,
      },
      "/api/beta": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: stripApiPrefix,
      },
      "/api/factors": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: stripApiPrefix,
      },
      "/api/portfolio": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: stripApiPrefix,
      },
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/candles": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    server: {
      deps: {
        inline: [/solid-js/, /@solidjs/, /@kobalte/, /@tanstack/],
      },
    },
  },
})
