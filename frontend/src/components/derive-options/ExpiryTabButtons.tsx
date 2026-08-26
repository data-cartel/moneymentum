import { For, type Accessor } from "solid-js"

import { formatExpiryTabLabel } from "./optionChainFormat"
import type { ExpiryTab } from "./expiryTabs"
import type { ExpiryUnix } from "./optionsSnapshot"

export type { ExpiryTab } from "./expiryTabs"
export { stabilizeExpiryTabs } from "./expiryTabs"

export const ExpiryTabButtons = (props: {
  tabs: Accessor<ExpiryTab[]>
  selectedUnix: Accessor<ExpiryUnix | null>
  onSelect: (unix: ExpiryUnix) => void
}) => (
  <For each={props.tabs()}>
    {tab => (
      <button
        type="button"
        classList={{
          "d-expiry": true,
          "d-expiry-active": props.selectedUnix() === tab.unix,
          "shrink-0": true,
        }}
        onMouseDown={() => {
          props.onSelect(tab.unix)
        }}
        onClick={(
          event: MouseEvent & {
            currentTarget: HTMLButtonElement
            target: Element
          },
        ) => {
          if (event.detail === 0) {
            props.onSelect(tab.unix)
          }
        }}
      >
        {formatExpiryTabLabel(tab.iso)}
      </button>
    )}
  </For>
)
