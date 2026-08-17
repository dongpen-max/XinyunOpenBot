export const PANE_LAYOUT_STORAGE_KEY = "xinyunopen-pane-layout";
export const PANE_DIVIDER_WIDTH = 7;
export const CENTER_PANE_MIN_WIDTH = 360;
export const LEFT_PANE_MIN_WIDTH = 92;
export const LEFT_PANE_COMPACT_MAX_WIDTH = 180;
export const LEFT_PANE_MAX_WIDTH = 520;
export const LEFT_PANE_DEFAULT_WIDTH = 300;
export const RIGHT_PANE_MIN_WIDTH = 300;
export const RIGHT_PANE_MAX_WIDTH = 760;
export const RIGHT_PANE_DEFAULT_WIDTH = 420;

export interface PaneWidths {
  left: number;
  right: number;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

export function isCompactLeftPane(width: number): boolean {
  return finite(width, LEFT_PANE_DEFAULT_WIDTH) <= LEFT_PANE_COMPACT_MAX_WIDTH;
}

export function clampLeftPaneWidth(
  width: number,
  rightWidth: number,
  viewportWidth: number,
  rightOpen: boolean,
): number {
  const dividers = rightOpen ? PANE_DIVIDER_WIDTH * 2 : PANE_DIVIDER_WIDTH;
  const reservedRight = rightOpen ? rightWidth : 0;
  const max = viewportWidth - CENTER_PANE_MIN_WIDTH - reservedRight - dividers;
  return Math.round(clamp(finite(width, LEFT_PANE_DEFAULT_WIDTH), LEFT_PANE_MIN_WIDTH, Math.min(LEFT_PANE_MAX_WIDTH, max)));
}

export function clampRightPaneWidth(width: number, leftWidth: number, viewportWidth: number): number {
  const max = viewportWidth - CENTER_PANE_MIN_WIDTH - leftWidth - PANE_DIVIDER_WIDTH * 2;
  return Math.round(clamp(finite(width, RIGHT_PANE_DEFAULT_WIDTH), RIGHT_PANE_MIN_WIDTH, Math.min(RIGHT_PANE_MAX_WIDTH, max)));
}

export function normalizePaneWidths(
  input: Partial<PaneWidths>,
  viewportWidth: number,
  rightOpen: boolean,
): PaneWidths {
  let left = clamp(
    finite(input.left, LEFT_PANE_DEFAULT_WIDTH),
    LEFT_PANE_MIN_WIDTH,
    LEFT_PANE_MAX_WIDTH,
  );
  let right = clamp(
    finite(input.right, RIGHT_PANE_DEFAULT_WIDTH),
    RIGHT_PANE_MIN_WIDTH,
    RIGHT_PANE_MAX_WIDTH,
  );

  if (!rightOpen) {
    left = clampLeftPaneWidth(left, 0, viewportWidth, false);
    return { left, right: Math.round(right) };
  }

  const sideBudget = Math.max(
    LEFT_PANE_MIN_WIDTH + RIGHT_PANE_MIN_WIDTH,
    viewportWidth - CENTER_PANE_MIN_WIDTH - PANE_DIVIDER_WIDTH * 2,
  );
  let overflow = left + right - sideBudget;
  if (overflow > 0) {
    const leftReduction = Math.min(overflow, left - LEFT_PANE_MIN_WIDTH);
    left -= leftReduction;
    overflow -= leftReduction;
    right -= Math.min(overflow, right - RIGHT_PANE_MIN_WIDTH);
  }

  return { left: Math.round(left), right: Math.round(right) };
}
