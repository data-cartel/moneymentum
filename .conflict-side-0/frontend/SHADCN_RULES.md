# Shadcn-Solid UI Component Rules

This project uses [shadcn-solid](https://shadcn-solid.com/) components (Kobalte
primitives with Tailwind styling).

## Component Installation

```bash
cd frontend
bunx shadcn-solid@latest add [component-name]
```

This installs to `src/components/ui/` and adds dependencies to `package.json`.

## Import Pattern

```typescript
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
```

## Styling

- Use `cn()` from `@/lib/cn` for conditional classes
- CSS variables for theming (defined in `src/index.css`)
- Use `class` not `className` (SolidJS convention)

## Kobalte Primitives

shadcn-solid wraps `@kobalte/core` primitives. Key differences from Radix:

| Radix (React)          | Kobalte (SolidJS)                  |
| ---------------------- | ---------------------------------- |
| `data-[state=open]`    | `data-[expanded]`                  |
| `data-[state=closed]`  | `data-[closed]`                    |
| `data-[state=checked]` | `data-[checked]`                   |
| `data-[state=active]`  | `data-[selected]`                  |
| `asChild`              | `as={Component}` or `as="element"` |
| `React.forwardRef`     | `splitProps` + pass `ref`          |
| `onCheckedChange`      | `onChange`                         |
| `className`            | `class`                            |
| `sideOffset`           | `gutter` (on Root)                 |

## Available Components

See `src/components/ui/` for the full list of installed components.

## Rules

1. Always use shadcn-solid components before building custom ones
2. Check https://shadcn-solid.com/ before creating custom implementations
3. Keep component APIs consistent with shadcn-solid patterns
4. Use Kobalte data attributes, not Radix ones
