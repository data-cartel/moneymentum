import { createSignal, type ParentProps } from "solid-js"
import { NetworkContext } from "./network-context"

export const NetworkProvider = (props: ParentProps) => {
  const [isNetworkSwitching, setIsNetworkSwitching] = createSignal(false)

  return (
    <NetworkContext.Provider
      value={{ isNetworkSwitching, setIsNetworkSwitching }}
    >
      {props.children}
    </NetworkContext.Provider>
  )
}
