import { describe, expect, it } from "vitest";
import { formatTokens } from "./format-tokens";

describe("formatTokens", () => {
  it("hides invalid and zero values", () => {
    expect(formatTokens(0)).toBeNull();
    expect(formatTokens(Number.NaN)).toBeNull();
  });

  it("formats small, thousand and million totals", () => {
    expect(formatTokens(1)).toBe("1 token");
    expect(formatTokens(842)).toBe("842 tokens");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(999_950)).toBe("1M");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });
});
