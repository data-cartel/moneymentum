import { describe, expect, it } from "vitest"

import {
  isEditableKeyboardTarget,
  isKeyboardSuppressed,
} from "./isKeyboardSuppressed"

describe("isEditableKeyboardTarget", () => {
  it("detects input textarea select and contenteditable", () => {
    const input = document.createElement("input")
    const textarea = document.createElement("textarea")
    const select = document.createElement("select")
    const editable = document.createElement("div")
    editable.contentEditable = "true"
    const plain = document.createElement("div")

    expect(isEditableKeyboardTarget(input)).toBe(true)
    expect(isEditableKeyboardTarget(textarea)).toBe(true)
    expect(isEditableKeyboardTarget(select)).toBe(true)
    expect(isEditableKeyboardTarget(editable)).toBe(true)
    expect(isEditableKeyboardTarget(plain)).toBe(false)
    expect(isEditableKeyboardTarget(null)).toBe(false)
  })
})

describe("isKeyboardSuppressed", () => {
  it("suppresses when pin dialog is open", () => {
    expect(
      isKeyboardSuppressed({
        eventTarget: document.createElement("div"),
        isPinDialogOpen: true,
      }),
    ).toBe(true)
  })

  it("suppresses when focus is in an input", () => {
    expect(
      isKeyboardSuppressed({
        eventTarget: document.createElement("input"),
        isPinDialogOpen: false,
      }),
    ).toBe(true)
  })

  it("allows when focus is on a plain element", () => {
    expect(
      isKeyboardSuppressed({
        eventTarget: document.createElement("div"),
        isPinDialogOpen: false,
      }),
    ).toBe(false)
  })
})
