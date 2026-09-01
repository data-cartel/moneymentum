import type { Accessor, JSX } from "solid-js"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu"

import { SettingsMenuGearTrigger } from "./SettingsMenuGearTrigger"

export const DeriveSettingsMenu = (props: {
  greeksVisible: Accessor<boolean>
  onGreeksVisibleChange: (visible: boolean) => void
}): JSX.Element => (
  <DropdownMenu>
    <SettingsMenuGearTrigger aria-label="Open Derive settings" />
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
