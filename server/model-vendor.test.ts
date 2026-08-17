import { describe, expect, it } from "vitest";
import { inferModelVendor } from "../src/lib/model-vendor.ts";

describe("inferModelVendor", () => {
  it.each([
    ["gpt-5.6-sol", "openai"],
    ["claude-sonnet-4", "anthropic"],
    ["gemini-3.1-pro", "google"],
    ["deepseek-v4", "deepseek"],
    ["glm-5.2", "zhipu"],
    ["qwen-max", "qwen"],
    ["kimi-k2.5", "moonshot"],
    ["grok-4.1", "xai"],
  ] as const)("uses the creator encoded by relay model %s", (modelId, vendor) => {
    expect(inferModelVendor({ driverKind: "grok", displayName: "模型中转", modelId })).toBe(vendor);
  });

  it("uses the model label when an opaque model id is returned", () => {
    expect(inferModelVendor({ driverKind: "grok", modelId: "vendor/model-42", modelLabel: "GPT-5.6 Sol" })).toBe("openai");
  });

  it("uses instance metadata before falling back to the transport driver", () => {
    expect(inferModelVendor({ driverKind: "grok", displayName: "自定义 DeepSeek", modelId: "chat" })).toBe("deepseek");
  });

  it("falls back to driverKind for legacy catalogs without vendor hints", () => {
    expect(inferModelVendor({ driverKind: "claudeAgent", modelId: "default" })).toBe("anthropic");
    expect(inferModelVendor({ driverKind: "boxAgent", modelId: "computer" })).toBe("computer");
  });
});
