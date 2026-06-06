import { splitProps, type JSX } from "solid-js"
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

const Table = (props: JSX.HTMLAttributes<HTMLTableElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <div data-slot="table-container" class="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        class={twMerge(clsx("w-full caption-bottom text-sm", local.class))}
        {...rest}
      />
    </div>
  )
}

const TableHeader = (props: JSX.HTMLAttributes<HTMLTableSectionElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <thead
      data-slot="table-header"
      class={twMerge(clsx("[&_tr]:border-b", local.class))}
      {...rest}
    />
  )
}

const TableBody = (props: JSX.HTMLAttributes<HTMLTableSectionElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <tbody
      data-slot="table-body"
      class={twMerge(clsx("[&_tr:last-child]:border-0", local.class))}
      {...rest}
    />
  )
}

const TableFooter = (props: JSX.HTMLAttributes<HTMLTableSectionElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <tfoot
      data-slot="table-footer"
      class={twMerge(
        clsx(
          "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const TableRow = (props: JSX.HTMLAttributes<HTMLTableRowElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <tr
      data-slot="table-row"
      class={twMerge(
        clsx(
          "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const TableHead = (props: JSX.ThHTMLAttributes<HTMLTableCellElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <th
      data-slot="table-head"
      class={twMerge(
        clsx(
          "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const TableCell = (props: JSX.TdHTMLAttributes<HTMLTableCellElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <td
      data-slot="table-cell"
      class={twMerge(
        clsx(
          "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
          local.class,
        ),
      )}
      {...rest}
    />
  )
}

const TableCaption = (props: JSX.HTMLAttributes<HTMLTableCaptionElement>) => {
  const [local, rest] = splitProps(props, ["class"])

  return (
    <caption
      data-slot="table-caption"
      class={twMerge(clsx("text-muted-foreground mt-4 text-sm", local.class))}
      {...rest}
    />
  )
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
}
