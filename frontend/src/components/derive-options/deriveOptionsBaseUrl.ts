/** Base URL for options bootstrap/snapshot/SSE (Vite proxies `/api` -> moneymentum). */
export const deriveOptionsBaseUrl = (): string => {
  const viteDeriveUrl: unknown = import.meta.env.VITE_DERIVE_SERVER_URL
  if (typeof viteDeriveUrl === "string" && viteDeriveUrl.length > 0) {
    return viteDeriveUrl.replace(/\/$/, "")
  }
  return "/api"
}
