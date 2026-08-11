import { splitProps, type JSX } from "solid-js"

import { cn } from "@/lib/cn"
import { badgeVariants, type BadgeVariants } from "@/lib/badge-variants"

interface BadgeProps
  extends JSX.HTMLAttributes<HTMLDivElement>, BadgeVariants {}

const Badge = (props: BadgeProps) => {
  const [local, rest] = splitProps(props, ["class", "variant"])

  return (
    <div
      class={cn(badgeVariants({ variant: local.variant }), local.class)}
      {...rest}
    />
  )
}

export { Badge }
export type { BadgeProps }
