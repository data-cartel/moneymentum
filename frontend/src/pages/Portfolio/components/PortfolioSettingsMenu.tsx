import { For, type JSX } from "solid-js"
import { Settings } from "lucide-solid"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  PORTFOLIO_METRIC_COLUMN_LABELS,
  PORTFOLIO_METRIC_COLUMN_ORDER,
  type PortfolioMetricColumnId,
  type PortfolioMetricVisibility,
} from "./PositionsPanel/portfolioMetricVisibility"

export interface PortfolioSettingsMenuProps {
  isPrecise: boolean
  onPreciseChange: (value: boolean) => void
  isManualWeightEntry: boolean
  onManualWeightEntryChange: (value: boolean) => void
  metricVisibility: PortfolioMetricVisibility
  onMetricVisibilityChange: (
    columnId: PortfolioMetricColumnId,
    visible: boolean,
  ) => void
}

export const PortfolioSettingsMenu = (
  props: PortfolioSettingsMenuProps,
): JSX.Element => (
  <DropdownMenu>
    <DropdownMenuTrigger
      as={Button}
      variant="ghost"
      size="icon"
      class="h-6 w-6"
      aria-label="Open positions settings"
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
        checked={props.isPrecise}
        closeOnSelect={false}
        onChange={value => {
          props.onPreciseChange(value)
        }}
      >
        Precise
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={props.isManualWeightEntry}
        closeOnSelect={false}
        onChange={value => {
          props.onManualWeightEntryChange(value)
        }}
      >
        Manual weight entry
      </DropdownMenuCheckboxItem>
      <For each={PORTFOLIO_METRIC_COLUMN_ORDER}>
        {columnId => (
          <DropdownMenuCheckboxItem
            checked={props.metricVisibility[columnId]}
            closeOnSelect={false}
            onChange={value => {
              props.onMetricVisibilityChange(columnId, value)
            }}
          >
            {PORTFOLIO_METRIC_COLUMN_LABELS[columnId]}
          </DropdownMenuCheckboxItem>
        )}
      </For>
    </DropdownMenuContent>
  </DropdownMenu>
)
