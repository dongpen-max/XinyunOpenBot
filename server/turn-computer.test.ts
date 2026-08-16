import { describe, expect, it } from "vitest";

import { shouldUseCloudComputer } from "./turn-computer.ts";

describe("shouldUseCloudComputer", () => {
  it("uses cloud for normal auto turns and explicit top-level cloud turns", () => {
    expect(shouldUseCloudComputer(undefined, "mcp", 0)).toBe(true);
    expect(shouldUseCloudComputer("cloud", "mcp", 0)).toBe(true);
  });

  it("keeps every nested ask_bot turn off the parent's shared Box lease", () => {
    expect(shouldUseCloudComputer(undefined, "mcp", 1)).toBe(false);
    expect(shouldUseCloudComputer(undefined, "native", 1)).toBe(false);
    expect(shouldUseCloudComputer("cloud", "mcp", 1)).toBe(false);
    expect(shouldUseCloudComputer("cloud", "native", 1)).toBe(false);
  });

  it("respects local, off, and unsupported providers", () => {
    expect(shouldUseCloudComputer("local", "mcp", 0)).toBe(false);
    expect(shouldUseCloudComputer("off", "mcp", 0)).toBe(false);
    expect(shouldUseCloudComputer("cloud", undefined, 0)).toBe(false);
  });
});
