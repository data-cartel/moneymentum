import { splitProps } from "solid-js"
import { useTheme } from "@/hooks/useTheme"
import { Toaster as Sonner, type ToasterProps } from "solid-sonner"

import { cn } from "@/lib/cn"

const Toaster = (props: ToasterProps) => {
  const { theme } = useTheme()

  const [local, rest] = splitProps(props, ["theme", "class", "toastOptions"])

  return (
    <Sonner
      theme={local.theme ?? (theme() as "light" | "dark" | "system")}
      class={cn("toaster group", local.class)}
      toastOptions={{
        classes: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
        ...local.toastOptions,
      }}
      {...rest}
    />
  )
}

export { Toaster }
