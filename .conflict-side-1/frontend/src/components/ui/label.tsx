import type { Component, ComponentProps } from "solid-js"
import { splitProps } from "solid-js"

import { cn } from "@/lib/cn"

const Label: Component<ComponentProps<"label">> = props => {
  const [local, others] = splitProps(props, ["class"])
  return (
    <label
      class={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled]:pointer-events-none group-data-[disabled]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  )
}

export { Label }
