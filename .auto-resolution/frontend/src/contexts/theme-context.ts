import { createContext, type Accessor } from "solid-js"

type Theme = "dark" | "light" | "system"

export type ThemeProviderState = {
  theme: Accessor<Theme>
  setTheme: (theme: Theme) => void
}

export const ThemeProviderContext = createContext<
  ThemeProviderState | undefined
>(undefined)
