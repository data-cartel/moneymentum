import {
  createSignal,
  createEffect,
  onCleanup,
  untrack,
  type JSX,
} from "solid-js"
import { ThemeProviderContext } from "@/contexts/theme-context"

type Theme = "dark" | "light" | "system"

interface ThemeProviderProps {
  children: JSX.Element
  defaultTheme?: Theme
  storageKey?: string
}

export const ThemeProvider = (props: ThemeProviderProps) => {
  const storageKey = untrack(() => props.storageKey) ?? "vite-ui-theme"
  const defaultTheme = props.defaultTheme ?? "system"

  const [theme, setTheme] = createSignal<Theme>(
    (localStorage.getItem(storageKey) as Theme | null) ?? defaultTheme,
  )

  // Apply the active theme class to <html> whenever the theme signal changes.
  // This must be an effect (not a memo) because it performs a DOM side-effect.
  createEffect(() => {
    const currentTheme = theme()
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (currentTheme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)")

      const applySystemTheme = () => {
        root.classList.remove("light", "dark")
        root.classList.add(mq.matches ? "dark" : "light")
      }

      applySystemTheme()

      mq.addEventListener("change", applySystemTheme)
      onCleanup(() => {
        mq.removeEventListener("change", applySystemTheme)
      })

      return
    }

    root.classList.add(currentTheme)
  })

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme)
      setTheme(newTheme)
    },
  }

  return (
    <ThemeProviderContext.Provider value={value}>
      {props.children}
    </ThemeProviderContext.Provider>
  )
}
