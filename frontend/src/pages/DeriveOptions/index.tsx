import type { Accessor, JSX } from "solid-js"

import {
  OptionsTradingView,
  type OptionsTradingViewProps,
} from "@/components/derive-options"

export type {
  OptionsBootstrap,
  OptionsSnapshot,
} from "@/components/derive-options"

/** Standalone options explorer; risk + smile stay on this route only. */
const DeriveOptionsPage = (): JSX.Element => {
  const streamEnabled: Accessor<boolean> = () => true
  const viewProps: OptionsTradingViewProps = {
    streamEnabled,
    showRiskAndSmile: true,
    class: "h-screen",
  }

  return <OptionsTradingView {...viewProps} />
}

export default DeriveOptionsPage
