import { describe, it, expect } from "vitest"
import {
  getDirection,
  isNavigationKey,
  isHorizontalKey,
  isVerticalKey,
} from "./keys"

describe("getDirection", () => {
  describe("vim keys", () => {
    it("returns 'left' for h", () => {
      expect(getDirection("h")).toBe("left")
    })

    it("returns 'down' for j", () => {
      expect(getDirection("j")).toBe("down")
    })

    it("returns 'up' for k", () => {
      expect(getDirection("k")).toBe("up")
    })

    it("returns 'right' for l", () => {
      expect(getDirection("l")).toBe("right")
    })
  })

  describe("arrow keys", () => {
    it("returns 'left' for ArrowLeft", () => {
      expect(getDirection("ArrowLeft")).toBe("left")
    })

    it("returns 'right' for ArrowRight", () => {
      expect(getDirection("ArrowRight")).toBe("right")
    })

    it("returns 'up' for ArrowUp", () => {
      expect(getDirection("ArrowUp")).toBe("up")
    })

    it("returns 'down' for ArrowDown", () => {
      expect(getDirection("ArrowDown")).toBe("down")
    })
  })

  describe("non-navigation keys", () => {
    it("returns null for non-navigation keys", () => {
      expect(getDirection("a")).toBeNull()
      expect(getDirection("Enter")).toBeNull()
      expect(getDirection("Escape")).toBeNull()
      expect(getDirection("1")).toBeNull()
      expect(getDirection(" ")).toBeNull()
    })
  })
})

describe("isNavigationKey", () => {
  it("returns true for vim keys", () => {
    expect(isNavigationKey("h")).toBe(true)
    expect(isNavigationKey("j")).toBe(true)
    expect(isNavigationKey("k")).toBe(true)
    expect(isNavigationKey("l")).toBe(true)
  })

  it("returns true for arrow keys", () => {
    expect(isNavigationKey("ArrowLeft")).toBe(true)
    expect(isNavigationKey("ArrowRight")).toBe(true)
    expect(isNavigationKey("ArrowUp")).toBe(true)
    expect(isNavigationKey("ArrowDown")).toBe(true)
  })

  it("returns false for non-navigation keys", () => {
    expect(isNavigationKey("a")).toBe(false)
    expect(isNavigationKey("Enter")).toBe(false)
    expect(isNavigationKey("Escape")).toBe(false)
    expect(isNavigationKey("1")).toBe(false)
  })
})

describe("isHorizontalKey", () => {
  it("returns true for horizontal vim keys", () => {
    expect(isHorizontalKey("h")).toBe(true)
    expect(isHorizontalKey("l")).toBe(true)
  })

  it("returns true for horizontal arrow keys", () => {
    expect(isHorizontalKey("ArrowLeft")).toBe(true)
    expect(isHorizontalKey("ArrowRight")).toBe(true)
  })

  it("returns false for vertical keys", () => {
    expect(isHorizontalKey("j")).toBe(false)
    expect(isHorizontalKey("k")).toBe(false)
    expect(isHorizontalKey("ArrowUp")).toBe(false)
    expect(isHorizontalKey("ArrowDown")).toBe(false)
  })

  it("returns false for non-navigation keys", () => {
    expect(isHorizontalKey("a")).toBe(false)
    expect(isHorizontalKey("Enter")).toBe(false)
  })
})

describe("isVerticalKey", () => {
  it("returns true for vertical vim keys", () => {
    expect(isVerticalKey("j")).toBe(true)
    expect(isVerticalKey("k")).toBe(true)
  })

  it("returns true for vertical arrow keys", () => {
    expect(isVerticalKey("ArrowUp")).toBe(true)
    expect(isVerticalKey("ArrowDown")).toBe(true)
  })

  it("returns false for horizontal keys", () => {
    expect(isVerticalKey("h")).toBe(false)
    expect(isVerticalKey("l")).toBe(false)
    expect(isVerticalKey("ArrowLeft")).toBe(false)
    expect(isVerticalKey("ArrowRight")).toBe(false)
  })

  it("returns false for non-navigation keys", () => {
    expect(isVerticalKey("a")).toBe(false)
    expect(isVerticalKey("Enter")).toBe(false)
  })
})
