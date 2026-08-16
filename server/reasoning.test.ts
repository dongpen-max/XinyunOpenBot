import { describe, expect, it } from "vitest";

import {
  parseReasoningEffort,
  parseReasoningLevel,
  parseReasoningRequest,
  reasoningEffortForLevel,
} from "./reasoning.ts";

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

describe("five-level reasoning request", () => {
  it("accepts the five UI values and maps them onto the three provider values", () => {
    expect(parseReasoningLevel("minimal")).toBe("minimal");
    expect(parseReasoningLevel("maximum")).toBe("maximum");
    expect(reasoningEffortForLevel("minimal")).toBe("low");
    expect(reasoningEffortForLevel("low")).toBe("low");
    expect(reasoningEffortForLevel("medium")).toBe("medium");
    expect(reasoningEffortForLevel("high")).toBe("high");
    expect(reasoningEffortForLevel("maximum")).toBe("high");
  });

  it("prefers the new field while accepting an old client request", () => {
    expect(parseReasoningRequest("maximum", "low")).toBe("maximum");
    expect(parseReasoningRequest(undefined, "high")).toBe("high");
    expect(parseReasoningRequest(undefined, undefined)).toBeUndefined();
    expect(() => parseReasoningRequest("max", undefined)).toThrow(/minimal, low, medium, high, or maximum/);
  });
});
