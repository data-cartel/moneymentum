import { splitProps, type JSX } from "solid-js"
import { twMerge } from "tailwind-merge"

const Skeleton = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      class={twMerge("animate-pulse rounded-md bg-primary/10", local.class)}
      {...rest}
    />
  )
}

export { Skeleton }
