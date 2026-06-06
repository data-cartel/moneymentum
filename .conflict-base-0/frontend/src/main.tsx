/* @refresh reload */
import { render } from "solid-js/web"
import { Router, Route } from "@solidjs/router"
import { lazy } from "solid-js"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { AppLayout, FullscreenLayout } from "./App"
import { NetworkProvider } from "./contexts/NetworkContext"
import { WalletProvider } from "./contexts/WalletProvider"
import { ThemeProvider } from "./components/ui/theme-provider"
import "./index.css"

const PortfolioPage = lazy(() => import("./pages/Portfolio"))
const MainPage = lazy(() => import("./pages/MainPage"))
const PrototypePage = lazy(() => import("./pages/Prototype"))
const TokenPage = lazy(() => import("./pages/TokenPage"))

const NotFound = () => <div>Page not found</div>

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

// In dev, surface uncaught errors and unhandled rejections explicitly in the console.
if (import.meta.env.DEV && typeof window !== "undefined") {
  window.addEventListener("error", event => {
    console.error("[Global error]", {
      message: event.message,
      error: event.error as unknown,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  })

  window.addEventListener("unhandledrejection", event => {
    console.error("[Unhandled promise rejection]", {
      reason: event.reason as unknown,
    })
  })
}

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Root element not found")
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <NetworkProvider>
          <WalletProvider>
            <Router>
              <Route path="/prototype" component={FullscreenLayout}>
                <Route path="/*" component={PrototypePage} />
              </Route>
              <Route path="/" component={AppLayout}>
                <Route path="/" component={PortfolioPage} />
                <Route path="/dashboard" component={MainPage} />
                <Route path="/token/:ticker" component={TokenPage} />
              </Route>
              <Route path="*404" component={NotFound} />
            </Router>
          </WalletProvider>
        </NetworkProvider>
      </ThemeProvider>
    </QueryClientProvider>
  ),
  rootElement,
)
