/// Deterministic stand-in for the Hyperliquid info API, the only external
/// system in the contract e2e suite. Serves a fixed two-market universe plus
/// enough candle and funding history for ingestion to complete against it.

import { createServer } from "node:http"

const port = 8022

const universe = [
  { name: "BTC", szDecimals: 8, maxLeverage: 50 },
  { name: "ETH", szDecimals: 4, maxLeverage: 25 },
]

const intervalMilliseconds: Record<string, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
}

interface CandleRequest {
  coin: string
  interval: string
}

const candleSnapshot = ({ coin, interval }: CandleRequest) => {
  const step = intervalMilliseconds[interval] ?? intervalMilliseconds["1h"]
  const candleCount = 60
  const lastOpen = Math.floor(Date.now() / step) * step - step

  return Array.from({ length: candleCount }, (_, candleIndex) => {
    const openTime = lastOpen - (candleCount - 1 - candleIndex) * step
    const basePrice = coin === "BTC" ? 42000 : 2500
    const drift = candleIndex * (coin === "BTC" ? 10 : 1)
    return {
      t: openTime,
      T: openTime + step - 1,
      s: coin,
      i: interval,
      o: String(basePrice + drift),
      c: String(basePrice + drift + 5),
      h: String(basePrice + drift + 10),
      l: String(basePrice + drift - 10),
      v: "1000.0",
      n: 500,
    }
  })
}

const fundingHistory = (coin: string) => {
  const hour = 60 * 60 * 1000
  const lastFunding = Math.floor(Date.now() / hour) * hour
  return Array.from({ length: 48 }, (_, entryIndex) => ({
    coin,
    fundingRate: "0.0001",
    premium: "0.00005",
    time: lastFunding - (47 - entryIndex) * hour,
  }))
}

interface InfoRequest {
  type: string
  coin?: string
  req?: CandleRequest
}

const infoResponse = (infoRequest: InfoRequest): unknown => {
  switch (infoRequest.type) {
    case "meta":
      return { universe }
    case "candleSnapshot":
      return infoRequest.req ? candleSnapshot(infoRequest.req) : []
    case "fundingHistory":
      return infoRequest.coin ? fundingHistory(infoRequest.coin) : []
    default:
      return {}
  }
}

const server = createServer((httpRequest, httpResponse) => {
  const respondJson = (payload: unknown) => {
    httpResponse.writeHead(200, { "content-type": "application/json" })
    httpResponse.end(JSON.stringify(payload))
  }

  if (httpRequest.method === "GET" && httpRequest.url === "/health") {
    respondJson({ status: "ok" })
    return
  }

  if (httpRequest.method === "POST" && httpRequest.url === "/info") {
    const bodyChunks: Buffer[] = []
    httpRequest.on("data", (chunk: Buffer) => bodyChunks.push(chunk))
    httpRequest.on("end", () => {
      const body = JSON.parse(
        Buffer.concat(bodyChunks).toString(),
      ) as InfoRequest
      respondJson(infoResponse(body))
    })
    return
  }

  httpResponse.writeHead(404)
  httpResponse.end("not found")
})

server.listen(port, "127.0.0.1", () => {
  console.log(`mock hyperliquid ready on http://127.0.0.1:${String(port)}`)
})
