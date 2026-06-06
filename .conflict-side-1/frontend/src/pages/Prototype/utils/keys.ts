/**
 * Vim/Arrow key abstraction for consistent keyboard navigation.
 *
 * Maps both vim keys (h/j/k/l) and arrow keys to directional actions.
 * This ensures vim users and arrow key users have parity throughout the app.
 */

export type Direction = "left" | "right" | "up" | "down"

const KEY_TO_DIRECTION: Record<string, Direction> = {
  // Vim keys
  h: "left",
  j: "down",
  k: "up",
  l: "right",
  // Arrow keys
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

/**
 * Get the direction for a key, or null if not a navigation key.
 */
export const getDirection = (key: string): Direction | null => {
  return KEY_TO_DIRECTION[key] ?? null
}

/**
 * Check if a key is a navigation key (vim or arrow).
 */
export const isNavigationKey = (key: string): boolean => {
  return key in KEY_TO_DIRECTION
}

/**
 * Check if a key represents horizontal movement.
 */
export const isHorizontalKey = (key: string): boolean => {
  const dir = getDirection(key)
  return dir === "left" || dir === "right"
}

/**
 * Check if a key represents vertical movement.
 */
export const isVerticalKey = (key: string): boolean => {
  const dir = getDirection(key)
  return dir === "up" || dir === "down"
}
