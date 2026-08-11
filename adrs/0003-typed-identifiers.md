# ADR 0003: typed identifiers

- Status: Approved
- Date: 2026-06-29

## Context

A domain identifier carries meaning: what entity it names, and -- when we author
it -- how its string form is built. Collapsing that meaning into a bare `String`
(or `format!` at the call site, or a type alias) throws the meaning away and
invites three bug classes:

- **Stringly typed.** A bare `String`/`Option<String>` for an ID. Nothing stops
  an unrelated string from being passed where the ID is expected, and nothing
  documents the ID's shape.
- **Scattered construction.** `format!("ingestion-{...}")` (or the inverse
  parse) duplicated across call sites. The string <-> value mapping has no
  single definition, so the two drift.
- **Alias collapse.** `type RunId = String;` does nothing for the compiler --
  two aliases of the same primitive are the same type.

`IngestionRunId` was the trigger: a `struct IngestionRunId(String)` whose `new`
built `ingestion-{micros}-{nonce}` with `format!` and whose `FromStr` was
`Infallible` -- it accepted _any_ string as a valid id, validating nothing.

This pattern is established in the sibling st0x repos
(`st0x.liquidity/adrs/0004-typed-identifiers.md`, `st0x.issuance/docs/ids.md`);
this ADR brings the same rules here.

## Decision

A value whose string form is _determined by other values_ is modeled as those
values, and the string is **derived** from them. The string is never the stored
source of truth.

1. **Every ID has a type.** A bare `String` for an ID field is a bug.
2. **An ID built from N inputs is a struct (or enum) of N typed fields.** The
   rendered string comes from a `Display` conversion over the fields; `FromStr`
   is its single inverse and returns a real, typed parse error -- never
   `Infallible`. The fields, not the string, are what we store and compare.
3. **Construction is centralized on the type.** No `format!("…-{}", …)` at call
   sites and no parsing at call sites -- the string <-> value mapping has
   exactly one definition, on the type.
4. **A value from a fixed, finite set of literals is an enum** (a single literal
   is a unit variant); a value with alternative shapes is an enum of variants
   (e.g. legacy vs. current format), not a parallel type.
5. **A `String`/`Uuid` newtype is acceptable only when the body is genuinely
   opaque** -- authored by an external system, parsed/validated but never
   constructed or destructured by us. Even then it owns its parser, not a bare
   public field.
6. **Aliases are not types.** If two names must be distinguishable, at least one
   is a newtype.

### Generation and round-trip

- IDs we mint ourselves use `uuid::Uuid::new_v4()` for the random component. No
  ULID, no timestamp-only ids.
- An id held in memory must equal the value parsed back from its own `Display`
  output. When the wire form is lower-resolution than a field (e.g. a timestamp
  rendered at microsecond precision), store the field at that resolution so the
  round-trip is exact -- otherwise an in-process id and the same id loaded from
  the event store compare unequal.
- The wire/serde form is always the rendered string: derive serde for `Uuid`
  newtypes; hand-write `serialize`/`deserialize` via `Display`/`FromStr` for
  structs and enums so the flat string -- not a JSON object -- crosses the wire.

## Status in this codebase

- `IngestionRunId` -- now a struct `{ started_at_micros, nonce }` with
  `Display`/`FromStr`, a typed `IngestionRunIdParseError`, and round-trip-stable
  microsecond precision. (Was `struct IngestionRunId(String)`.)
- `PortfolioId(Uuid)` -- compliant: UUID newtype, `Display`/`FromStr`.
- `MarketId { venue, symbol }` -- compliant: a struct of typed fields.

## Consequences

- Invalid id strings are rejected at the boundary instead of flowing through the
  system as plausible-but-wrong values.
- The string form of every id has one definition, so render and parse cannot
  drift.
- New ids follow the rules above; reviewers reject bare-`String` ids.
