import * as Data from "effect/Data"
import * as Schema from "effect/Schema"

export class OptionsPayloadDecodeError extends Data.TaggedError(
  "OptionsPayloadDecodeError",
)<{
  readonly cause: unknown
}> {}

export const OptionKind = Schema.Literal("C", "P")
export type OptionKind = typeof OptionKind.Type

export const Moneyness = Schema.Literal(
  "in_the_money",
  "at_the_money",
  "out_of_the_money",
)
export type Moneyness = typeof Moneyness.Type

export const ExpiryUnix = Schema.Number.pipe(
  Schema.int(),
  Schema.brand("ExpiryUnix"),
)
export type ExpiryUnix = typeof ExpiryUnix.Type

export const OptionGreeks = Schema.Struct({
  bid_iv: Schema.NullOr(Schema.Number),
  ask_iv: Schema.NullOr(Schema.Number),
  delta: Schema.NullOr(Schema.Number),
  gamma: Schema.NullOr(Schema.Number),
  vega: Schema.NullOr(Schema.Number),
  theta: Schema.NullOr(Schema.Number),
  iv: Schema.NullOr(Schema.Number),
  rho: Schema.NullOr(Schema.Number),
  forward_price: Schema.NullOr(Schema.Number),
  discount_factor: Schema.NullOr(Schema.Number),
  option_model_mark: Schema.NullOr(Schema.Number),
})
export type OptionGreeks = typeof OptionGreeks.Type

export const OptionQuote = Schema.Struct({
  instrument_name: Schema.String,
  kind: OptionKind,
  strike: Schema.Number,
  expiry: Schema.String,
  expiry_unix: ExpiryUnix,
  bid: Schema.NullOr(Schema.Number),
  ask: Schema.NullOr(Schema.Number),
  bid_size: Schema.NullOr(Schema.Number),
  ask_size: Schema.NullOr(Schema.Number),
  mark: Schema.NullOr(Schema.Number),
  spot_price: Schema.Number,
  moneyness: Moneyness,
  greeks: OptionGreeks,
})
export type OptionQuote = typeof OptionQuote.Type

export const OptionsSnapshot = Schema.Struct({
  asset: Schema.String,
  updated_at: Schema.String,
  active_expiry_unix: ExpiryUnix,
  expiry_unixes: Schema.Array(ExpiryUnix),
  spot_price: Schema.Number,
  expiry_dates: Schema.Array(Schema.String),
  strikes: Schema.Array(Schema.Number),
  quotes: Schema.Array(OptionQuote),
})
export type OptionsSnapshot = typeof OptionsSnapshot.Type

export const OptionsBootstrap = Schema.Struct({
  asset: Schema.String,
  assets: Schema.Array(Schema.String),
  default_expiry_unix: ExpiryUnix,
  tabs: Schema.Array(
    Schema.Struct({
      expiry_unix: ExpiryUnix,
      instruments: Schema.Array(Schema.String),
    }),
  ),
})
export type OptionsBootstrap = typeof OptionsBootstrap.Type

export const decodeOptionsBootstrap = Schema.decodeUnknown(OptionsBootstrap)
export const decodeOptionsSnapshot = Schema.decodeUnknown(OptionsSnapshot)
export const decodeOptionsSnapshotEither =
  Schema.decodeUnknownEither(OptionsSnapshot)

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
