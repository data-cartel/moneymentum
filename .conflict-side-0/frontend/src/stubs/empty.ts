/**
 * Empty stub for Node.js-only modules that ccxt imports dynamically.
 *
 * ccxt wraps these imports in try/catch and gracefully handles missing modules.
 * In browsers, SOCKS proxy support isn't available anyway, so this stub satisfies
 * the import without breaking ccxt's functionality for our Hyperliquid use case.
 *
 * Used by vite.config.ts to alias: socks-proxy-agent
 */
export default {}
