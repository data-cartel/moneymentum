/** Minimal browser stub for ccxt's `import { isIP } from "node:net"`. */
export const isIP = (input: string): 0 | 4 | 6 => {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input)) {
    return 4
  }
  if (input.includes(":")) {
    return 6
  }
  return 0
}

export const isIPv4 = (input: string): boolean => isIP(input) === 4
export const isIPv6 = (input: string): boolean => isIP(input) === 6
