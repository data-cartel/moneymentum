import { For, Show, type JSX } from "solid-js"

import { cn } from "@/lib/cn"

import { hotkeyHintsForPanel, type KeyboardPanelId } from "./hotkeyHints"

interface PortfolioHotkeyBarProps {
  focusedPanel: KeyboardPanelId
  class?: string
}

export const PortfolioHotkeyBar = (
  props: PortfolioHotkeyBarProps,
): JSX.Element => {
  const hints = () => hotkeyHintsForPanel(props.focusedPanel)

  return (
    <div
      class={cn(
        "flex h-7 shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-muted/30 px-3 text-[10px] text-muted-foreground",
        props.class,
      )}
      data-testid="portfolio-hotkey-bar"
      aria-label="Keyboard shortcuts"
    >
      <Show when={hints().length > 0}>
        <For each={hints()}>
          {hint => (
            <span class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
              <kbd class="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
                {hint.keys}
              </kbd>
              <span>{hint.description}</span>
            </span>
          )}
        </For>
      </Show>
    </div>
  )
}
