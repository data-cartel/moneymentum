export type OptionKind = "C" | "P"
export type Moneyness = "in_the_money" | "at_the_money" | "out_of_the_money"

export type ExpiryUnix = number & { readonly __brand: "ExpiryUnix" }

export type OptionGreeks = {
  bid_iv: number | null
  ask_iv: number | null
  delta: number | null
  gamma: number | null
  vega: number | null
  theta: number | null
  iv: number | null
  rho: number | null
  forward_price: number | null
  discount_factor: number | null
  option_model_mark: number | null
}

export type OptionQuote = {
  instrument_name: string
  kind: OptionKind
  strike: number
  expiry: string
  expiry_unix: ExpiryUnix
  bid: number | null
  ask: number | null
  bid_size: number | null
  ask_size: number | null
  mark: number | null
  spot_price: number
  moneyness: Moneyness
  greeks: OptionGreeks
}

export type PortfolioRiskSummary = {
  aggregate_delta: number
  aggregate_gamma: number
  aggregate_vega: number
  aggregate_theta: number
  hedge_ratio_btc: number
}

export type ScenarioPoint = {
  pct_move: number
  estimated_pnl: number
}

export type OptionsSnapshot = {
  asset: string
  updated_at: string
  active_expiry_unix: ExpiryUnix
  expiry_unixes: ExpiryUnix[]
  spot_price: number
  expiry_dates: string[]
  strikes: number[]
  quotes: OptionQuote[]
  risk: PortfolioRiskSummary
  scenarios: ScenarioPoint[]
}

export type OptionsBootstrap = {
  asset: string
  assets: string[]
  default_expiry_unix: ExpiryUnix
  tabs: Array<{ expiry_unix: ExpiryUnix; instruments: string[] }>
}

export const EMPTY_TAB_RISK: PortfolioRiskSummary = {
  aggregate_delta: 0,
  aggregate_gamma: 0,
  aggregate_vega: 0,
  aggregate_theta: 0,
  hedge_ratio_btc: 0,
}

export const EMPTY_OPTION_GREEKS: OptionGreeks = {
  bid_iv: null,
  ask_iv: null,
  delta: null,
  gamma: null,
  vega: null,
  theta: null,
  iv: null,
  rho: null,
  forward_price: null,
  discount_factor: null,
  option_model_mark: null,
}
