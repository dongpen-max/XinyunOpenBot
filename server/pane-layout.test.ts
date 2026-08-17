import { describe, expect, it } from "vitest";

import {
  CENTER_PANE_MIN_WIDTH,
  LEFT_PANE_COMPACT_MAX_WIDTH,
  LEFT_PANE_DEFAULT_WIDTH,
  LEFT_PANE_MIN_WIDTH,
  PANE_DIVIDER_WIDTH,
  RIGHT_PANE_DEFAULT_WIDTH,
  clampLeftPaneWidth,
  clampRightPaneWidth,
  isCompactLeftPane,
  normalizePaneWidths,
} from "../src/lib/pane-layout.ts";

describe("resizable pane layout", () => {
  it("keeps the preferred three-pane widths on a large window", () => {
    expect(normalizePaneWidths({}, 1440, true)).toEqual({
      left: LEFT_PANE_DEFAULT_WIDTH,
      right: RIGHT_PANE_DEFAULT_WIDTH,
    });
  });

  it("provides a true icon-rail width below the compact sidebar threshold", () => {
    expect(LEFT_PANE_MIN_WIDTH).toBeLessThan(LEFT_PANE_COMPACT_MAX_WIDTH);
    expect(clampLeftPaneWidth(0, RIGHT_PANE_DEFAULT_WIDTH, 1440, true)).toBe(LEFT_PANE_MIN_WIDTH);
    expect(isCompactLeftPane(LEFT_PANE_COMPACT_MAX_WIDTH)).toBe(true);
    expect(isCompactLeftPane(LEFT_PANE_COMPACT_MAX_WIDTH + 1)).toBe(false);
  });

  it("shrinks side panes to preserve a usable center on a narrow window", () => {
    const widths = normalizePaneWidths({ left: 420, right: 600 }, 900, true);
    expect(widths.left).toBe(LEFT_PANE_MIN_WIDTH);
    expect(widths.left + widths.right + CENTER_PANE_MIN_WIDTH + PANE_DIVIDER_WIDTH * 2).toBeLessThanOrEqual(900);
  });

  it("clamps the left divider without changing the open right pane", () => {
    expect(clampLeftPaneWidth(700, 360, 1200, true)).toBe(
      1200 - 360 - CENTER_PANE_MIN_WIDTH - PANE_DIVIDER_WIDTH * 2,
    );
  });

  it("clamps the right divider against the current left pane", () => {
    expect(clampRightPaneWidth(900, 260, 1200)).toBe(
      1200 - 260 - CENTER_PANE_MIN_WIDTH - PANE_DIVIDER_WIDTH * 2,
    );
  });

  it("ignores invalid persisted values", () => {
    expect(normalizePaneWidths({ left: Number.NaN, right: -40 }, 1440, true)).toEqual({
      left: LEFT_PANE_DEFAULT_WIDTH,
      right: 300,
    });
  });
});
