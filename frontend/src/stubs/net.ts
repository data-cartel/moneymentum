/** Minimal browser stub for ccxt's `import { isIP } from "node:net"`. */

const isIPv4Octet = (octet: string): boolean =>
  /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255

const isIPv4Literal = (input: string): boolean => {
  const octets = input.split(".")
  return octets.length === 4 && octets.every(isIPv4Octet)
}

const isHextet = (hextet: string): boolean => /^[0-9a-fA-F]{1,4}$/.test(hextet)

/**
 * Validates an IPv6 literal: up to 8 hextets, at most one `::` compression,
 * optional embedded IPv4 in the final 32 bits, and an optional non-empty
 * zone ID suffix (`%eth0`), matching `node:net.isIP`.
 */
const isIPv6Literal = (fullInput: string): boolean => {
  const zoneSeparatorIndex = fullInput.indexOf("%")
  if (
    zoneSeparatorIndex !== -1 &&
    !/^[0-9a-zA-Z-.:]+$/.test(fullInput.slice(zoneSeparatorIndex + 1))
  ) {
    return false
  }
  const input =
    zoneSeparatorIndex === -1
      ? fullInput
      : fullInput.slice(0, zoneSeparatorIndex)

  const compressionSplit = input.split("::")
  if (compressionSplit.length > 2) {
    return false
  }

  const hasCompression = compressionSplit.length === 2
  const [headPart, tailPart = ""] = compressionSplit

  const headGroups = headPart === "" ? [] : headPart.split(":")
  const tailGroups = tailPart === "" ? [] : tailPart.split(":")

  // Without `::`, a leading or trailing lone colon is malformed.
  if (!hasCompression && (input.startsWith(":") || input.endsWith(":"))) {
    return false
  }

  const groups = hasCompression ? [...headGroups, ...tailGroups] : headGroups
  if (groups.some(group => group.includes(".") && !input.endsWith(group))) {
    // An embedded IPv4 part must terminate the address.
    return false
  }
  const lastGroup = groups.length > 0 ? groups[groups.length - 1] : undefined
  const embeddedIPv4 = lastGroup?.includes(".") ? lastGroup : undefined

  const hextetGroups = embeddedIPv4 === undefined ? groups : groups.slice(0, -1)
  if (!hextetGroups.every(isHextet)) {
    return false
  }
  if (embeddedIPv4 !== undefined && !isIPv4Literal(embeddedIPv4)) {
    return false
  }

  // Embedded IPv4 occupies two hextet slots.
  const groupCount = hextetGroups.length + (embeddedIPv4 === undefined ? 0 : 2)
  return hasCompression ? groupCount < 8 : groupCount === 8
}

export const isIP = (input: string): 0 | 4 | 6 => {
  if (isIPv4Literal(input)) {
    return 4
  }
  if (isIPv6Literal(input)) {
    return 6
  }
  return 0
}

export const isIPv4 = (input: string): boolean => isIP(input) === 4
export const isIPv6 = (input: string): boolean => isIP(input) === 6
