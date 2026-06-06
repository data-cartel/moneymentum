# Moneymentum Frontend

SolidJS + TypeScript trading dashboard built with Vite, TailwindCSS 4, and
Kobalte UI (shadcn-solid).

## Development

```bash
bun --cwd frontend run dev    # Development server (port 5173)
bun --cwd frontend run build  # Production build
bun --cwd frontend run lint   # Lint check
bun --cwd frontend run test   # Run tests
```

## Design Philosophy

The prototype dashboard targets professional institutional traders. Design
decisions prioritize information density and operational efficiency over
aesthetic polish.

### Information Density

Screen real estate is precious. Every element must earn its space:

- Single-character badges (`L`/`S`) instead of verbose labels
- Metrics in compact layouts with aligned columns
- Features collapsed into dropdowns until needed

### Risk Management First

Global leverage is a core feature, not a nice-to-have. Traders scale risk by
adjusting leverage while keeping portfolio composition intact. The formula
`notional = NAV x weight x leverage` ensures proportional scaling.

### Flexibility Over Assumptions

Factor exposures (beta to BTC, beta to SPY) are user-configurable. Different
strategies require different benchmarks. The dashboard should not impose
hardcoded assumptions about what factors matter.

### Consistency

Same information, same format. Numbers align. Badges have uniform width. Child
rows match parent styling patterns. Visual consistency reduces cognitive load.

See `AGENTS.md` for detailed guidelines for AI agents working on this codebase.
