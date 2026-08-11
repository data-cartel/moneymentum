import { For, Show, createMemo, type JSX } from "solid-js"
import { toast } from "solid-sonner"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useCancelDeriveOrder,
  useDeriveOpenOrders,
  useDeriveSessionCredentials,
} from "@/hooks/useTrading"
import { useWallet } from "@/hooks/useWallet"
import { getErrorMessage } from "@/lib/error-message"

import { mapDeriveOpenOrderRows } from "./deriveOpenOrders"

const formatSignedSize = (amount: number | null, side: string): string => {
  if (amount === null) {
    return "—"
  }
  const sign = side === "sell" ? "-" : "+"
  return `${sign}${amount}`
}

const formatPrice = (price: number | null): string => {
  if (price === null) {
    return "—"
  }
  return price.toLocaleString("en-US", {
    maximumFractionDigits: 8,
  })
}

const formatUsd = (value: number | null): string => {
  if (value === null) {
    return "—"
  }
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Resting Derive orders for the unlocked session subaccount.
 * Not merged into portfolio weights -- fills become positions elsewhere.
 */
export const DeriveOpenOrdersPanel = (): JSX.Element => {
  const { isDeriveConnected, isDeriveLocked } = useWallet()
  const session = useDeriveSessionCredentials()
  const openOrdersQuery = useDeriveOpenOrders()
  const cancelOrderMutation = useCancelDeriveOrder()

  const rows = createMemo(() =>
    mapDeriveOpenOrderRows(openOrdersQuery.data ?? []),
  )

  const isVisible = () => isDeriveConnected() && !isDeriveLocked()
  const hasSubaccount = () => {
    const current = session()
    return current !== null && current.subaccountId !== null
  }
  const canFetch = () => isVisible() && hasSubaccount()

  const cancelOrder = (orderId: string, symbol: string) => {
    if (cancelOrderMutation.isPending || !canFetch()) {
      return
    }

    cancelOrderMutation.mutate(
      { id: orderId, symbol },
      {
        onSuccess: () => {
          toast.success("Order canceled")
        },
        onError: error => {
          toast.error(getErrorMessage(error))
        },
      },
    )
  }

  return (
    <Show when={isVisible()}>
      <div class="shrink-0 space-y-2 border-t border-border px-3 py-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Open orders
          </h3>
          <Button
            size="sm"
            variant="outline"
            class="h-6 px-2 text-[11px]"
            disabled={!canFetch() || openOrdersQuery.isFetching}
            onClick={() => {
              if (!canFetch()) {
                return
              }
              void openOrdersQuery.refetch()
            }}
          >
            {openOrdersQuery.isFetching ? "Loading..." : "Refresh"}
          </Button>
        </div>

        <Show
          when={canFetch()}
          fallback={
            <p class="text-[11px] text-muted-foreground">
              Select a Derive subaccount in the wallet menu to load open orders.
            </p>
          }
        >
          <Show when={openOrdersQuery.error}>
            <p class="text-[11px] text-destructive">
              {getErrorMessage(openOrdersQuery.error)}
            </p>
          </Show>

          <Show
            when={!openOrdersQuery.isLoading}
            fallback={<Skeleton class="h-8 w-full" />}
          >
            <Show
              when={rows().length > 0}
              fallback={
                <p class="text-[11px] text-muted-foreground">No open orders</p>
              }
            >
              <div class="overflow-x-auto">
                <table class="w-full border-collapse text-left font-mono text-[11px]">
                  <thead>
                    <tr class="border-b border-border text-muted-foreground">
                      <th class="px-1 py-1 font-medium">Instrument</th>
                      <th class="px-1 py-1 font-medium">Side</th>
                      <th class="px-1 py-1 font-medium">Size</th>
                      <th class="px-1 py-1 font-medium">Price</th>
                      <th class="px-1 py-1 font-medium">Notional</th>
                      <th class="px-1 py-1 font-medium">Status</th>
                      <th class="px-1 py-1 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    <For each={rows()}>
                      {order => (
                        <tr class="border-b border-border/60">
                          <td class="px-1 py-1.5" title={order.symbol}>
                            {order.label}
                          </td>
                          <td class="px-1 py-1.5 uppercase">{order.side}</td>
                          <td class="px-1 py-1.5">
                            {formatSignedSize(order.amount, order.side)}
                          </td>
                          <td class="px-1 py-1.5">
                            {formatPrice(order.price)}
                          </td>
                          <td class="px-1 py-1.5">
                            {formatUsd(order.notional)}
                          </td>
                          <td class="px-1 py-1.5 capitalize">
                            {order.status}
                            <span class="text-muted-foreground">
                              {" "}
                              · {order.orderType}
                            </span>
                          </td>
                          <td class="px-1 py-1.5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              class="h-6 px-2 text-[11px] text-rose-500"
                              disabled={cancelOrderMutation.isPending}
                              onClick={() => {
                                cancelOrder(order.id, order.symbol)
                              }}
                            >
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </Show>
  )
}
