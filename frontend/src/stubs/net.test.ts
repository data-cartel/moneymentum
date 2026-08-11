import { describe, expect, it } from "vitest"

import { isIP, isIPv4, isIPv6 } from "./net"

describe("isIP", () => {
  it("returns 4 for valid IPv4 literals", () => {
    expect(isIP("127.0.0.1")).toBe(4)
    expect(isIP("0.0.0.0")).toBe(4)
    expect(isIP("255.255.255.255")).toBe(4)
  })

  it("returns 0 for malformed IPv4 octets", () => {
    expect(isIP("999.1.1.1")).toBe(0)
    expect(isIP("256.0.0.1")).toBe(0)
    expect(isIP("1.2.3.04")).toBe(0)
    expect(isIP("1.2.3")).toBe(0)
    expect(isIP("1.2.3.4.5")).toBe(0)
  })

  it("returns 6 for valid IPv6 literals", () => {
    expect(isIP("::")).toBe(6)
    expect(isIP("::1")).toBe(6)
    expect(isIP("2001:db8::8a2e:370:7334")).toBe(6)
    expect(isIP("1:2:3:4:5:6:7:8")).toBe(6)
    expect(isIP("1:2:3:4:5:6:7::")).toBe(6)
    expect(isIP("::ffff:192.168.0.1")).toBe(6)
    expect(isIP("fe80::1%eth0")).toBe(6)
    expect(isIP("1:2:3:4:5:6:1.2.3.4")).toBe(6)
  })

  it("returns 0 for arbitrary colon-containing strings", () => {
    expect(isIP("not:an-ip")).toBe(0)
    expect(isIP("localhost:8080")).toBe(0)
    expect(isIP("1::2::3")).toBe(0)
    expect(isIP("1:2:3:4:5:6:7:8:9")).toBe(0)
    expect(isIP("1:2:3:4:5:6:7::8")).toBe(0)
    expect(isIP("1.2.3.4::")).toBe(0)
    expect(isIP("::ffff:999.1.1.1")).toBe(0)
    expect(isIP("::1%")).toBe(0)
    expect(isIP("1.2.3.4%eth0")).toBe(0)
    expect(isIP("1:2:3:4:5:6:7:1.2.3.4")).toBe(0)
  })

  it("returns 0 for non-IP strings", () => {
    expect(isIP("")).toBe(0)
    expect(isIP("example.com")).toBe(0)
  })
})

describe("isIPv4 and isIPv6", () => {
  it("delegate to isIP", () => {
    expect(isIPv4("127.0.0.1")).toBe(true)
    expect(isIPv4("999.1.1.1")).toBe(false)
    expect(isIPv6("::1")).toBe(true)
    expect(isIPv6("not:an-ip")).toBe(false)
  })
})
