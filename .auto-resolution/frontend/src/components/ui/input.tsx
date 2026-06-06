import { splitProps, type JSX } from "solid-js"

import { cn } from "@/lib/cn"

interface InputProps extends JSX.InputHTMLAttributes<HTMLInputElement> {
  ref?: HTMLInputElement | ((element: HTMLInputElement) => void)
}

const Input = (props: InputProps) => {
  const [local, rest] = splitProps(props, ["class", "type", "ref"])

  return (
    <input
      type={local.type}
      class={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        local.class,
      )}
      ref={local.ref}
      {...rest}
    />
  )
}

export { Input }
export type { InputProps }
