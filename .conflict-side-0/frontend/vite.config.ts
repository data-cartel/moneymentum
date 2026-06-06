/// <reference types="vitest" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import solid from "vite-plugin-solid"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"

const stripApiPrefix = (proxyPath: string): string =>
  proxyPath.replace(/^\/api/, "")

const netStub = path.resolve(__dirname, "./src/stubs/net.ts")

// These WalletConnect utils ship ESM under dist/esm but only declare CJS
// "main" in package.json. Vite then serves CJS as native ESM and named
// imports like `toMiliseconds` fail at runtime.
const walletConnectEsm = (packageName: string): string =>
  path.resolve(
    __dirname,
    `node_modules/@walletconnect/${packageName}/dist/esm/index.js`,
  )

export default defineConfig({
  base: "/",
  plugins: [
    solid(),
    tailwindcss(),
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
      "@walletconnect/time": walletConnectEsm("time"),
      "@walletconnect/environment": walletConnectEsm("environment"),
      "@walletconnect/window-getters": walletConnectEsm("window-getters"),
      "@walletconnect/window-metadata": walletConnectEsm("window-metadata"),
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
