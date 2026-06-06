import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly cause: unknown
}> {}

export class HttpStatusError extends Data.TaggedError("HttpStatusError")<{
  readonly status: number
  readonly detail?: string | undefined
}> {}

export class JsonParseError extends Data.TaggedError("JsonParseError")<{
  readonly cause: unknown
}> {}

export class JsonSerializeError extends Data.TaggedError("JsonSerializeError")<{
  readonly cause: unknown
}> {}

const request = (
  url: string,
  init?: RequestInit,
): Effect.Effect<Response, NetworkError> =>
  Effect.tryPromise({
    try: () => fetch(url, init),
    catch: cause => new NetworkError({ cause }),
  })

const extractDetail = (body: unknown): string | undefined => {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const raw = (body as Record<string, unknown>).detail
    return typeof raw === "string" ? raw : undefined
  }
  return undefined
}

const ensureOk = (
  response: Response,
): Effect.Effect<Response, HttpStatusError> =>
  response.ok
    ? Effect.succeed(response)
    : Effect.promise(() =>
        response.json().catch(() => undefined as unknown),
      ).pipe(
        Effect.flatMap(body =>
          Effect.fail(
            new HttpStatusError({
              status: response.status,
              detail: extractDetail(body),
            }),
          ),
        ),
      )

const parseJson = <A>(response: Response): Effect.Effect<A, JsonParseError> =>
  Effect.tryPromise({
    try: () => response.json() as Promise<A>,
    catch: cause => new JsonParseError({ cause }),
  })

export const fetchJson = <A>(
  url: string,
  init?: RequestInit,
): Effect.Effect<A, NetworkError | HttpStatusError | JsonParseError> =>
  request(url, init).pipe(Effect.flatMap(ensureOk), Effect.flatMap(parseJson))

export const postJson = <A>(
  url: string,
  body: unknown,
  init?: RequestInit,
): Effect.Effect<
  A,
  NetworkError | HttpStatusError | JsonParseError | JsonSerializeError
> => {
  const merged = new Headers(init?.headers)
  merged.set("Content-Type", "application/json")
  const headers = Object.fromEntries(merged.entries())

  return Effect.try({
    try: () => JSON.stringify(body),
    catch: cause => new JsonSerializeError({ cause }),
  }).pipe(
    Effect.flatMap(serialized =>
      fetchJson(url, {
        ...init,
        method: "POST",
        headers,
        body: serialized,
      }),
    ),
  )
}

export const fetchStreamChecked = (
  url: string,
  init?: RequestInit,
): Effect.Effect<Response, NetworkError | HttpStatusError> =>
  request(url, init).pipe(Effect.flatMap(ensureOk))

export const postEmpty = (
  url: string,
  init?: RequestInit,
): Effect.Effect<void, NetworkError | HttpStatusError> =>
  request(url, { ...init, method: "POST" }).pipe(
    Effect.flatMap(ensureOk),
    Effect.asVoid,
  )
