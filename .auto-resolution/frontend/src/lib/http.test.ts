import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Effect from "effect/Effect"
import {
  fetchJson,
  postJson,
  postEmpty,
  fetchStreamChecked,
  NetworkError,
  HttpStatusError,
  JsonParseError,
  JsonSerializeError,
} from "./http"

describe("http", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const mockFetch = () => globalThis.fetch as ReturnType<typeof vi.fn>

  describe("fetchJson", () => {
    it("returns parsed JSON on 200", async () => {
      const payload = { id: 1, name: "test" }
      mockFetch().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload),
      })

      const result = await Effect.runPromise(fetchJson("/api/test"))

      expect(result).toEqual(payload)
      expect(mockFetch()).toHaveBeenCalledWith("/api/test", undefined)
    })

    it("returns HttpStatusError with detail on non-ok response", async () => {
      mockFetch().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ detail: "Validation failed" }),
      })

      const exit = await Effect.runPromiseExit(fetchJson("/api/test"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(HttpStatusError)
          expect((error.error as HttpStatusError).status).toBe(422)
          expect((error.error as HttpStatusError).detail).toBe(
            "Validation failed",
          )
        }
      }
    })

    it("returns HttpStatusError without detail when body is unparseable", async () => {
      mockFetch().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      })

      const exit = await Effect.runPromiseExit(fetchJson("/api/test"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(HttpStatusError)
          expect((error.error as HttpStatusError).status).toBe(500)
          expect((error.error as HttpStatusError).detail).toBeUndefined()
        }
      }
    })

    it("returns HttpStatusError without detail when body is non-object JSON", async () => {
      mockFetch().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve("just a string"),
      })

      const exit = await Effect.runPromiseExit(fetchJson("/api/test"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(HttpStatusError)
          expect((error.error as HttpStatusError).status).toBe(400)
          expect((error.error as HttpStatusError).detail).toBeUndefined()
        }
      }
    })

    it("returns HttpStatusError without detail when body is null JSON", async () => {
      mockFetch().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve(null),
      })

      const exit = await Effect.runPromiseExit(fetchJson("/api/test"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(HttpStatusError)
          expect((error.error as HttpStatusError).detail).toBeUndefined()
        }
      }
    })

    it("returns NetworkError when fetch throws", async () => {
      const fetchError = new TypeError("Failed to fetch")
      mockFetch().mockRejectedValue(fetchError)

      const exit = await Effect.runPromiseExit(fetchJson("/api/test"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(NetworkError)
          expect((error.error as NetworkError).cause).toBe(fetchError)
        }
      }
    })

    it("returns JsonParseError on invalid JSON body", async () => {
      const jsonError = new SyntaxError("Unexpected token")
      mockFetch().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(jsonError),
      })

      const exit = await Effect.runPromiseExit(fetchJson("/api/test"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(JsonParseError)
          expect((error.error as JsonParseError).cause).toBe(jsonError)
        }
      }
    })
  })

  describe("postJson", () => {
    it("sends POST with correct method, headers, and body", async () => {
      const requestBody = { start_date: "2024-01-01" }
      const responseBody = { data: [] }
      mockFetch().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseBody),
      })

      const result = await Effect.runPromise(postJson("/api/data", requestBody))

      expect(result).toEqual(responseBody)
      expect(mockFetch()).toHaveBeenCalledWith("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })
    })

    it("merges additional init options", async () => {
      mockFetch().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      await Effect.runPromise(
        postJson("/api/data", {}, { signal: AbortSignal.timeout(5000) }),
      )

      expect(mockFetch()).toHaveBeenCalledWith(
        "/api/data",
        expect.objectContaining({
          method: "POST",
          signal: expect.any(AbortSignal),
        }),
      )
    })
  })

  describe("fetchStreamChecked", () => {
    it("returns Response on successful fetch", async () => {
      const mockResponse = { ok: true, body: "stream" }
      mockFetch().mockResolvedValue(mockResponse)

      const result = await Effect.runPromise(
        fetchStreamChecked("/api/stream", { method: "POST" }),
      )

      expect(result).toBe(mockResponse)
      expect(mockFetch()).toHaveBeenCalledWith("/api/stream", {
        method: "POST",
      })
    })

    it("returns HttpStatusError on non-ok response", async () => {
      mockFetch().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ detail: "Bad gateway" }),
      })

      const exit = await Effect.runPromiseExit(
        fetchStreamChecked("/api/stream"),
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(HttpStatusError)
          expect((error.error as HttpStatusError).status).toBe(502)
          expect((error.error as HttpStatusError).detail).toBe("Bad gateway")
        }
      }
    })

    it("returns NetworkError when fetch fails", async () => {
      mockFetch().mockRejectedValue(new TypeError("Network error"))

      const exit = await Effect.runPromiseExit(
        fetchStreamChecked("/api/stream"),
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(NetworkError)
        }
      }
    })
  })

  describe("postJson - serialization", () => {
    it("returns JsonSerializeError when body is not serializable", async () => {
      const circular: Record<string, unknown> = {}
      circular.self = circular

      const exit = await Effect.runPromiseExit(postJson("/api/test", circular))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(JsonSerializeError)
        }
      }
    })
  })

  describe("postEmpty", () => {
    it("sends POST and returns void on success", async () => {
      mockFetch().mockResolvedValue({ ok: true })

      await Effect.runPromise(postEmpty("/api/stop"))
      expect(mockFetch()).toHaveBeenCalledWith("/api/stop", { method: "POST" })
    })

    it("returns HttpStatusError on non-ok response", async () => {
      mockFetch().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: "Service unavailable" }),
      })

      const exit = await Effect.runPromiseExit(postEmpty("/api/stop"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(HttpStatusError)
          expect((error.error as HttpStatusError).status).toBe(503)
        }
      }
    })

    it("returns NetworkError when fetch fails", async () => {
      mockFetch().mockRejectedValue(new TypeError("Network error"))

      const exit = await Effect.runPromiseExit(postEmpty("/api/stop"))

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        const error = exit.cause
        if (error._tag === "Fail") {
          expect(error.error).toBeInstanceOf(NetworkError)
        }
      }
    })
  })
})
