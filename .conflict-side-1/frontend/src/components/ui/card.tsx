import { splitProps, type JSX } from "solid-js"

import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

const Card = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card"
      class={twMerge(
        clsx(
          "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border shadow-sm",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const CardHeader = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card-header"
      class={twMerge(
        clsx(
          "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const CardTitle = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card-title"
      class={twMerge(clsx("leading-none font-semibold", local.class))}
      {...rest}
    />
  )
}

const CardDescription = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card-description"
      class={twMerge(clsx("text-muted-foreground text-sm", local.class))}
      {...rest}
    />
  )
}

const CardAction = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card-action"
      class={twMerge(
        clsx(
          "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const CardContent = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card-content"
      class={twMerge(clsx("px-6", local.class))}
      {...rest}
    />
  )
}

const CardFooter = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div
      data-slot="card-footer"
      class={twMerge(
        clsx("flex items-center px-6 [.border-t]:pt-6", local.class),
      )}
      {...rest}
    />
  )
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
}
