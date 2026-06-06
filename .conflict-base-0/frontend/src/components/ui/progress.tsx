import type { ValidComponent } from "solid-js"
import { splitProps } from "solid-js"

import type { PolymorphicProps } from "@kobalte/core/polymorphic"
import * as ProgressPrimitive from "@kobalte/core/progress"

import { cn } from "@/lib/cn"

type ProgressProps<T extends ValidComponent = "div"> =
  ProgressPrimitive.ProgressRootProps<T> & { class?: string | undefined }

const Progress = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, ProgressProps<T>>,
) => {
  const [localProps, rootProps] = splitProps(props as ProgressProps, ["class"])
  return (
    <ProgressPrimitive.Root
      class={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        localProps.class,
      )}
      {...rootProps}
    >
      <ProgressPrimitive.Track class="h-full w-full">
        <ProgressPrimitive.Fill
          class="h-full w-full flex-1 bg-primary transition-all"
          style={{ width: "var(--kb-progress-fill-width)" }}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
