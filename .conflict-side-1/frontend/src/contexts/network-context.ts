import { createContext, type Accessor, type Setter } from "solid-js"

export interface NetworkContextType {
  isNetworkSwitching: Accessor<boolean>
  setIsNetworkSwitching: Setter<boolean>
}

export const NetworkContext = createContext<NetworkContextType | undefined>(
  undefined,
)
