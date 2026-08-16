import { describe, expect, it } from "vitest";

import { parseReasoningEffort } from "./reasoning.ts";

describe("parseReasoningEffort", () => {
  it("accepts the three supported per-message values", () => {
    expect(parseReasoningEffort("low")).toBe("low");
    expect(parseReasoningEffort("medium")).toBe("medium");
    expect(parseReasoningEffort("high")).toBe("high");
  });

  it("keeps omitted values optional and rejects malformed input", () => {
    expect(parseReasoningEffort(undefined)).toBeUndefined();
    expect(() => parseReasoningEffort("max")).toThrow(/low, medium, or high/);
  });
});
