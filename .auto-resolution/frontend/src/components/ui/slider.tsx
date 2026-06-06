import type { ValidComponent } from "solid-js"
import { Show, splitProps } from "solid-js"

import type { PolymorphicProps } from "@kobalte/core/polymorphic"
import * as SliderPrimitive from "@kobalte/core/slider"

import { cn } from "@/lib/cn"

type SliderProps<T extends ValidComponent = "div"> =
  SliderPrimitive.SliderRootProps<T> & {
    class?: string | undefined
    limitValue?: number
  }

const Slider = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, SliderProps<T>>,
) => {
  const [local, others] = splitProps(props as SliderProps, [
    "class",
    "limitValue",
    "minValue",
    "maxValue",
  ])

  const min = () => local.minValue ?? 0
  const max = () => local.maxValue ?? 100
  const range = () => max() - min()
  const limitPercent = () => {
    if (local.limitValue === undefined || range() <= 0) return 0
    const clamped = Math.min(Math.max(local.limitValue, min()), max())
    return ((clamped - min()) / range()) * 100
  }

  return (
    <SliderPrimitive.Root
      class={cn(
        "relative flex w-full touch-none select-none items-center",
        local.class,
      )}
      minValue={min()}
      maxValue={max()}
      {...others}
    >
      <SliderPrimitive.Track class="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
        <Show when={limitPercent() > 0}>
          <div
            class="absolute h-full bg-amber-500/30"
            style={{ width: `${String(limitPercent())}%` }}
          />
        </Show>
        <SliderPrimitive.Fill class="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb class="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50">
        <SliderPrimitive.Input />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  )
}

export { Slider }
export type { SliderProps }
