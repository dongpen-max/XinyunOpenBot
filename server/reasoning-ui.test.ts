import { describe, expect, it } from "vitest";

import {
  REASONING_LEVELS,
  reasoningLevelFromIndex,
  reasoningLevelIndex,
} from "../src/lib/reasoning-effort.ts";

describe("reasoning effort slider mapping", () => {
  it("maps all five visible stops without inventing provider wire values", () => {
    expect(REASONING_LEVELS.map((level) => level.value)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "maximum",
    ]);
    expect(reasoningLevelIndex("minimal")).toBe(0);
    expect(reasoningLevelIndex("medium")).toBe(2);
    expect(reasoningLevelIndex("maximum")).toBe(4);
    expect(reasoningLevelFromIndex(-10)).toBe("minimal");
    expect(reasoningLevelFromIndex(2.4)).toBe("medium");
    expect(reasoningLevelFromIndex(99)).toBe("maximum");
  });
});
