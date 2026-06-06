import type { ValidComponent } from "solid-js"
import { splitProps } from "solid-js"

import * as SwitchPrimitive from "@kobalte/core/switch"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"

import { cn } from "@/lib/cn"

type SwitchProps<T extends ValidComponent = "div"> =
  SwitchPrimitive.SwitchRootProps<T> & {
    class?: string | undefined
  }

const Switch = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SwitchProps<T>>,
) => {
  const [local, others] = splitProps(props as SwitchProps, ["class"])

  return (
    <SwitchPrimitive.Root {...others}>
      <SwitchPrimitive.Input class="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />
      <SwitchPrimitive.Control
        class={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors data-checked:bg-primary bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
          local.class,
        )}
      >
        <SwitchPrimitive.Thumb class="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-checked:translate-x-4 translate-x-0" />
      </SwitchPrimitive.Control>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
export type { SwitchProps }
