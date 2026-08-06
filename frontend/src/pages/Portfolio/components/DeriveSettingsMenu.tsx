import type { Accessor, JSX } from "solid-js"
import { Settings } from "lucide-solid"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export const DeriveSettingsMenu = (props: {
  greeksVisible: Accessor<boolean>
  onGreeksVisibleChange: (visible: boolean) => void
}): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger
      as={Button}
      variant="ghost"
      size="icon"
      class="h-6 w-6"
      aria-label="Open Derive settings"
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
    <DropdownMenuContent align="end">
      <DropdownMenuCheckboxItem
        checked={props.greeksVisible()}
        closeOnSelect={false}
        onChange={value => {
          props.onGreeksVisibleChange(value)
        }}
      >
        Greeks
      </DropdownMenuCheckboxItem>
    </DropdownMenuContent>
  </DropdownMenu>
)
