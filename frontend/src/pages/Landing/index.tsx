import { For, type JSX } from "solid-js"
import { A } from "@solidjs/router"
import {
  ArrowRight,
  ArrowUpRight,
  Layers,
  Droplets,
  BookOpen,
} from "lucide-solid"
import "./landing.css"

const GITHUB_ORG = "https://github.com/orgs/dataclique/repositories"

const PRODUCT_CARDS = [
  {
    name: "MONEYMENTUM",
    description:
      "Institutional quant toolkit for crypto portfolios. Weight-based targets, staged rebalances on Hyperliquid, and factor reads like BTC beta.",
    href: "https://github.com/dataclique/moneymentum",
  },
  {
    name: "STRIKE",
    description:
      "Options on perpetual futures on Sui. Move contracts plus a trading UI for decentralized options liquidity around perps.",
    href: "https://github.com/dataclique/strike",
  },
] as const

const ECOSYSTEM_CARDS = [
  {
    name: "ST0X.LIQUIDITY",
    description:
      "Tokenized-equity market maker on Raindex with automatic Alpaca hedges. Posts spreads around oracles and keeps exposure flat.",
    href: "https://github.com/ST0x-Technology/st0x.liquidity",
    icon: Droplets,
  },
  {
    name: "ST0X.ISSUANCE",
    description:
      "Issuer bot for Alpaca Instant Tokenization. Mints and redeems Rain vault shares so equities move on and off chain.",
    href: "https://github.com/ST0x-Technology/st0x.issuance",
    icon: Layers,
  },
  {
    name: "RAIN.ORDERBOOK",
    description:
      "Permissionless onchain orderbook with no fees or admin keys. Strategies expressed in Rainlang and settled via vaults.",
    href: "https://github.com/rainlanguage/raindex",
    icon: BookOpen,
  },
] as const

type Tone = "pos" | "neg"

interface DemoPosition {
  symbol: string
  leverage: string
  weight: string
  notional: string
  rate: string
  rateTone: Tone
  beta: string
}

const DEMO_POSITIONS: readonly DemoPosition[] = [
  {
    symbol: "SOL",
    leverage: "10x",
    weight: "37.29%",
    notional: "$73.75",
    rate: "95.76%",
    rateTone: "pos",
    beta: "1.24",
  },
  {
    symbol: "BTC",
    leverage: "40x",
    weight: "11.44%",
    notional: "$22.61",
    rate: "-10.95%",
    rateTone: "neg",
    beta: "1.00",
  },
  {
    symbol: "APE",
    leverage: "5x",
    weight: "7.62%",
    notional: "$15.07",
    rate: "-10.95%",
    rateTone: "neg",
    beta: "0.33",
  },
  {
    symbol: "AXS",
    leverage: "5x",
    weight: "6.91%",
    notional: "$13.66",
    rate: "-17.20%",
    rateTone: "neg",
    beta: "0.96",
  },
  {
    symbol: "APEX",
    leverage: "10x",
    weight: "6.75%",
    notional: "$13.35",
    rate: "-12.56%",
    rateTone: "neg",
    beta: "0.88",
  },
  {
    symbol: "ARB",
    leverage: "10x",
    weight: "6.20%",
    notional: "$12.26",
    rate: "-18.35%",
    rateTone: "neg",
    beta: "1.15",
  },
] as const

const DataCliqueMark = () => (
  <div class="dc-mark" aria-hidden="true">
    <span class="dc-mark-core" />
    <span class="dc-mark-ring" />
  </div>
)

const GlassButton = (props: {
  href: string
  label: string
  variant?: "primary" | "ghost" | "solid"
  external?: boolean
  icon?: JSX.Element
}) => {
  const className = () =>
    `dc-btn dc-btn-${props.variant ?? "primary"}${props.icon ? " dc-btn-with-icon" : ""}`

  return (
    <>
      {props.external ? (
        <a
          class={className()}
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>{props.label}</span>
          {props.icon}
        </a>
      ) : (
        <A class={className()} href={props.href}>
          <span>{props.label}</span>
          {props.icon}
        </A>
      )}
    </>
  )
}

const toneClass = (tone: Tone): string => `dc-tone-${tone}`

const HeroPanel = () => (
  <section class="dc-panel dc-panel-hero" aria-labelledby="dc-hero-title">
    <header class="dc-panel-nav">
      <div class="dc-brand">
        <DataCliqueMark />
        <span class="dc-brand-name">DataClique</span>
      </div>
    </header>

    <div class="dc-hero-body">
      <h1 id="dc-hero-title" class="dc-hero-title">
        DATACLIQUE: THE ULTIMATE <em class="dc-accent-italic">DEFI SUITE</em>
      </h1>

      <GlassButton
        href={GITHUB_ORG}
        label="EXPLORE REPOSITORIES"
        external
        icon={<ArrowUpRight size={16} stroke-width={2} />}
      />
    </div>
  </section>
)

const SolutionsPanel = () => (
  <section
    id="solutions"
    class="dc-panel dc-panel-solutions"
    aria-labelledby="dc-solutions-title"
  >
    <h2 id="dc-solutions-title" class="dc-section-title">
      SEAMLESS <em class="dc-accent-italic">DEFI</em> SOLUTIONS
    </h2>

    <div class="dc-product-grid">
      <For each={PRODUCT_CARDS}>
        {product => (
          <article class="dc-glass-card">
            <h3 class="dc-card-title">{product.name}</h3>
            <p class="dc-card-copy">{product.description}</p>
            <GlassButton
              href={product.href}
              label="GITHUB"
              variant="ghost"
              external
              icon={<ArrowUpRight size={14} stroke-width={2} />}
            />
          </article>
        )}
      </For>
    </div>
  </section>
)

const PositionsDemo = () => (
  <div class="dc-positions-demo" aria-hidden="true">
    <div class="dc-positions-scroll">
      <table class="dc-positions-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Side</th>
            <th>Weight</th>
            <th>Notional</th>
            <th>Rate</th>
            <th>Beta</th>
          </tr>
        </thead>
        <tbody>
          <For each={DEMO_POSITIONS}>
            {row => (
              <tr>
                <td>
                  <span class="dc-asset-cell">
                    <span class="dc-asset">{row.symbol}</span>
                    <span class="dc-lev">{row.leverage}</span>
                  </span>
                </td>
                <td>
                  <span class="dc-side">LONG</span>
                </td>
                <td>
                  <span class="dc-input-like">{row.weight}</span>
                </td>
                <td>
                  <span class="dc-input-like">{row.notional}</span>
                </td>
                <td class={toneClass(row.rateTone)}>{row.rate}</td>
                <td class="dc-tone-beta">{row.beta}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  </div>
)

const RebalancePanel = () => (
  <section
    id="rebalance"
    class="dc-panel dc-panel-rebalance"
    aria-labelledby="dc-rebalance-title"
  >
    <h2 id="dc-rebalance-title" class="dc-section-title dc-section-title-left">
      MONEYMENTUM: <em class="dc-accent-italic">SMART REBALANCING</em>
    </h2>

    <div class="dc-rebalance-body">
      <div class="dc-rebalance-copy">
        <p class="dc-rebalance-lede">
          Portfolios are proportions, not dollar tickets. Edit weights and
          notionals, inspect beta, then stage a return to target on Hyperliquid.
        </p>
        <GlassButton
          href="/portfolio"
          label="REBALANCE"
          variant="solid"
          icon={<ArrowRight size={16} stroke-width={2} />}
        />
      </div>

      <PositionsDemo />
    </div>
  </section>
)

const EcosystemPanel = () => (
  <section
    id="ecosystem"
    class="dc-panel dc-panel-ecosystem"
    aria-labelledby="dc-ecosystem-title"
  >
    <h2 id="dc-ecosystem-title" class="dc-section-title">
      ECOSYSTEM <em class="dc-accent-italic">CONTRIBUTIONS</em>
    </h2>

    <div class="dc-ecosystem-grid">
      <For each={ECOSYSTEM_CARDS}>
        {card => {
          const Icon = card.icon
          return (
            <article class="dc-eco-card">
              <div class="dc-eco-icon">
                <Icon size={18} stroke-width={1.5} />
              </div>
              <h3 class="dc-card-title">{card.name}</h3>
              <p class="dc-card-copy">{card.description}</p>
              <GlassButton
                href={card.href}
                label="GITHUB"
                variant="ghost"
                external
                icon={<ArrowUpRight size={14} stroke-width={2} />}
              />
            </article>
          )
        }}
      </For>
    </div>
  </section>
)

const LandingPage = () => (
  <div class="dc-landing">
    <div class="dc-nebula" aria-hidden="true">
      <div class="dc-orb dc-orb-a" />
      <div class="dc-orb dc-orb-b" />
      <div class="dc-orb dc-orb-c" />
      <div class="dc-haze" />
    </div>

    <main class="dc-grid">
      <HeroPanel />
      <SolutionsPanel />
      <RebalancePanel />
      <EcosystemPanel />
    </main>
  </div>
)

export default LandingPage
