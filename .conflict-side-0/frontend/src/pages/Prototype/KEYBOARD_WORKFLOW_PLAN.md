# Keyboard-Only Workflow Implementation Plan

## Target Workflow (Bloomberg/Vim Style)

A user should be able to complete this ENTIRE flow using ONLY keyboard:

1. **Open app** -> Screener focused by default
2. **Press `2`** -> Focus positions panel
3. **Press `j`/`k`** -> Navigate to an underlying (BTC, ETH, etc.)
4. **Press `o`** -> Expand the underlying to see instruments
5. **Press `j`/`k`** -> Navigate to specific instrument (perp, spot, option)
6. **Press `w`** -> Start editing weight, type value, press Enter
7. **Press `[` or `]`** -> Adjust leverage (GLOBALLY, from any panel)
8. **Press `x`** -> Execute all staged trades

NO MOUSE CLICKS ALLOWED.

## Current Gaps (Identified by Failing Tests)

### Gap 1: Leverage shortcuts only work when LeverageControl has focus

- **Problem**: `[` and `]` are handled in `LeverageControl.tsx` via `onKeyDown`
  which requires focus
- **Fix**: Add global keyboard listener in `index.tsx` that handles `[` and `]`
  regardless of focus

### Gap 2: No execute shortcut

- **Problem**: There's no way to execute staged trades without clicking the
  button
- **Fix**: Add `x` key handler in `index.tsx` that calls `executeStagedTrades()`

### Gap 3: Weight editing may not activate when instrument selected

- **Problem**: EditableCell listens for `editKey` when `isSelected` is true
- **Verify**: Ensure `isSelected` is properly passed to weight cells for
  instruments

### Gap 4: Test environment issues

- **Problem**: Tests need proper mocks for ResizeObserver, charts
- **Status**: Fixed with mocks

## Files to Modify

1. **`index.tsx`** - Add global handlers for `[`, `]`, `x`
2. **`useKeyboardNavigation.ts`** - May need to expose leverage/execute
   callbacks
3. **`full-keyboard-workflow.test.tsx`** - The TDD test

## Test File Location

`frontend/src/pages/Prototype/full-keyboard-workflow.test.tsx`

## Implementation Order (TDD)

1. [x] Write failing test describing exact workflow
2. [ ] Add global `[`/`]` handlers for leverage
3. [ ] Add `x` handler for execute
4. [ ] Verify weight editing works with `w` key
5. [ ] Make test pass

## Progress Checkpoint

Last updated: Session in progress

- Test file created with 6 tests
- 2 tests passing (leverage edit with 'e', keyboard hints)
- 4 tests failing (main workflow, notional edit, global leverage, execute)
