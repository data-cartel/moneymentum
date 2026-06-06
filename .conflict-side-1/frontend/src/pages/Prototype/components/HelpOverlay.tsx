import { For } from "solid-js"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { getShortcutGroups } from "../keyboard/shortcuts"

interface HelpOverlayProps {
  open: boolean
  onClose: () => void
}

const ShortcutGroup = (props: {
  title: string
  shortcuts: Array<{ key: string; description: string }>
}) => (
  <div class="space-y-1">
    <div class="text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {props.title}
    </div>
    <For each={props.shortcuts}>
      {shortcut => (
        <div class="flex items-center gap-2 text-sm">
          <kbd class="px-1.5 py-0.5 text-xs font-mono bg-muted rounded min-w-[24px] text-center">
            {shortcut.key}
          </kbd>
          <span class="text-muted-foreground">{shortcut.description}</span>
        </div>
      )}
    </For>
  </div>
)

export const HelpOverlay = (props: HelpOverlayProps) => {
  const shortcutGroups = getShortcutGroups()

  return (
    <Dialog
      open={props.open}
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent class="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div class="grid grid-cols-2 gap-6">
          <For each={shortcutGroups}>
            {group => (
              <ShortcutGroup title={group.title} shortcuts={group.shortcuts} />
            )}
          </For>
        </div>
        <div class="pt-3 border-t border-border text-xs text-muted-foreground">
          Press <kbd class="px-1 py-0.5 bg-muted rounded font-mono">?</kbd> or{" "}
          <kbd class="px-1 py-0.5 bg-muted rounded font-mono">Esc</kbd> to close
        </div>
      </DialogContent>
    </Dialog>
  )
}
