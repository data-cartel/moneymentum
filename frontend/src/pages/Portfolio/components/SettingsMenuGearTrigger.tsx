import type { JSX } from "solid-js"
import { Settings } from "lucide-solid"

import { Button } from "@/components/ui/button"
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

/** Ghost gear trigger shared by portfolio / Derive settings menus. */
export const SettingsMenuGearTrigger = (props: {
  "aria-label": string
}): JSX.Element => (
  <DropdownMenuTrigger
    as={Button}
    variant="ghost"
    size="icon"
    class="h-6 w-6"
    aria-label={props["aria-label"]}
    onPointerDown={(event: PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }}
    onClick={(event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }}
  >
    <Settings class="h-3.5 w-3.5" />
  </DropdownMenuTrigger>
)
