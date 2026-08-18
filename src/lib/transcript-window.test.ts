import { describe, expect, it } from "vitest";
import { expandWindowStart, resolveTranscriptWindow, tailWindowStart } from "./transcript-window";

describe("transcript window", () => {
  it("starts with the requested tail", () => {
    expect(tailWindowStart(250, 120)).toBe(130);
    expect(tailWindowStart(80, 120)).toBe(0);
  });

  it("expands backwards without crossing zero", () => {
    expect(expandWindowStart(250, 120)).toBe(130);
    expect(expandWindowStart(50, 120)).toBe(0);
  });

  it("keeps an anchored boundary while rows append", () => {
    const first = resolveTranscriptWindow([0, 1, 2, 3, 4], 2, 3);
    const appended = resolveTranscriptWindow([0, 1, 2, 3, 4, 5], first.startIndex, 3);
    expect(appended.visible).toEqual([2, 3, 4, 5]);
    expect(appended.hiddenCount).toBe(2);
  });

  it("re-tails when a stale boundary exceeds a shortened list", () => {
    expect(resolveTranscriptWindow([0, 1, 2], 8, 2)).toEqual({
      visible: [1, 2],
      hiddenCount: 1,
      startIndex: 1,
    });
  });
});
