import { createEffect, ErrorBoundary } from "solid-js"
import type { RouteSectionProps } from "@solidjs/router"

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message
  }
  try {
    return String(error)
  } catch {
    return "Unknown error"
  }
}

const readErrorStack = (error: unknown): string | undefined => {
  if (error instanceof Error && typeof error.stack === "string") {
    return error.stack
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "stack" in error &&
    typeof (error as { stack: unknown }).stack === "string"
  ) {
    return (error as { stack: string }).stack
  }
  return undefined
}

const formatErrorForDev = (error: unknown): string => {
  const stack = readErrorStack(error)
  if (stack !== undefined && stack.length > 0) {
    return stack
  }
  return readErrorMessage(error)
}

const ErrorFallback = (props: { error: unknown; reset: () => void }) => {
  createEffect(() => {
    if (import.meta.env.DEV) {
      console.error(props.error)
    }
  })

  return (
    <div class="flex h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <div class="text-destructive text-lg font-medium">
        Something went wrong
      </div>
      <div class="text-sm text-muted-foreground max-w-md text-center">
        An unexpected error occurred. Try refreshing the page or click retry.
      </div>
      <pre class="text-[16px] text-muted-foreground bg-muted rounded p-3 overflow-auto">
        {import.meta.env.DEV
          ? formatErrorForDev(props.error)
          : "An unexpected error occurred."}
      </pre>
      <button
        type="button"
        onClick={() => {
          props.reset()
        }}
        class="rounded-md border px-4 py-2 text-sm hover:bg-muted transition-colors"
      >
        Retry
      </button>
    </div>
  )
}

const renderFallback = (error: unknown, reset: () => void) => (
  <ErrorFallback error={error} reset={reset} />
)

export const AppLayout = (props: RouteSectionProps) => {
  return (
    <ErrorBoundary fallback={renderFallback}>
      <div class="flex h-screen flex-col overflow-hidden bg-background text-foreground text-[11px]">
        {props.children}
      </div>
    </ErrorBoundary>
  )
}

export const FullscreenLayout = (props: RouteSectionProps) => {
  return (
    <ErrorBoundary fallback={renderFallback}>{props.children}</ErrorBoundary>
  )
}
